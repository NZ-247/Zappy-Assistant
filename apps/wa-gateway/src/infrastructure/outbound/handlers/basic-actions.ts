import { sendTextAndPersist } from "../context.js";
import type { ExecuteOutboundActionsInput } from "../types.js";
import { AudioTranscodingError, inspectAudioPayload, transcodeToWhatsAppPtt } from "./wa-audio-transcoding.js";

const IMAGE_FETCH_TIMEOUT_MS = 12_000;
const IMAGE_FETCH_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_FETCH_MIN_BYTES = 512;

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeErrorReason = (error: unknown, fallback = "unknown_error"): string => {
  if (error instanceof AudioTranscodingError) return error.reason;
  if (error instanceof Error) {
    const message = normalizeText(error.message);
    return message || fallback;
  }
  return fallback;
};

const normalizeMimeType = (value?: string | null): string => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.split(";")[0]?.trim() ?? "";
};

const hasLikelyImageSignature = (bytes: Buffer): boolean => {
  if (bytes.length < 4) return false;
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return true;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  const gifSig = bytes.subarray(0, 6).toString("ascii");
  if (gifSig === "GIF87a" || gifSig === "GIF89a") return true;
  const riffSig = bytes.subarray(0, 4).toString("ascii");
  const webpSig = bytes.length >= 12 ? bytes.subarray(8, 12).toString("ascii") : "";
  if (riffSig === "RIFF" && webpSig === "WEBP") return true;
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return true;
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return true;
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii").toLowerCase();
    if (["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return true;
  }
  return false;
};

const looksLikeHtmlBody = (bytes: Buffer): boolean => {
  if (!bytes.length) return false;
  const probe = bytes.subarray(0, Math.min(bytes.length, 256)).toString("utf-8").trimStart().toLowerCase();
  return probe.startsWith("<!doctype html") || probe.startsWith("<html") || probe.startsWith("<?xml");
};

type FetchImageBufferResult =
  | { ok: true; buffer: Buffer; mimeType: string; byteLength: number; httpStatus: number }
  | { ok: false; reason: string; httpStatus?: number; mimeType?: string; byteLength?: number };

const fetchImageBuffer = async (imageUrl: string): Promise<FetchImageBufferResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "zappy-assistant/1.5 (+wa-gateway-image-send)"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: `http_${response.status}`,
        httpStatus: response.status
      };
    }

    const mimeType = normalizeMimeType(response.headers.get("content-type"));
    if (!mimeType.startsWith("image/")) {
      return {
        ok: false,
        reason: "invalid_content_type",
        mimeType
      };
    }

    if (mimeType === "image/svg+xml") {
      return {
        ok: false,
        reason: "unsupported_svg",
        mimeType
      };
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > IMAGE_FETCH_MAX_BYTES) {
      return {
        ok: false,
        reason: "payload_too_large",
        mimeType,
        byteLength: contentLength
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      return {
        ok: false,
        reason: "empty_body",
        mimeType,
        byteLength: 0
      };
    }
    if (bytes.length < IMAGE_FETCH_MIN_BYTES) {
      return {
        ok: false,
        reason: "body_too_small",
        mimeType,
        byteLength: bytes.length
      };
    }
    if (bytes.length > IMAGE_FETCH_MAX_BYTES) {
      return {
        ok: false,
        reason: "payload_too_large",
        mimeType,
        byteLength: bytes.length
      };
    }
    if (looksLikeHtmlBody(bytes)) {
      return {
        ok: false,
        reason: "suspicious_html_body",
        mimeType,
        byteLength: bytes.length
      };
    }
    if (!hasLikelyImageSignature(bytes)) {
      return {
        ok: false,
        reason: "invalid_image_signature",
        mimeType,
        byteLength: bytes.length
      };
    }
    return { ok: true, buffer: bytes, mimeType, byteLength: bytes.length, httpStatus: response.status };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
};

export const handleBasicOutboundAction = async (input: {
  runtime: ExecuteOutboundActionsInput;
  action: any;
  responseActionId: string;
}): Promise<boolean> => {
  const { runtime, action, responseActionId } = input;

  if (action.kind === "enqueue_job") {
    const runAt = action.payload.runAt ? new Date(action.payload.runAt) : new Date();
    if (action.jobType === "reminder") {
      await runtime.queueAdapter.enqueueReminder(String(action.payload.id), runAt);
    } else if (action.jobType === "timer") {
      await runtime.queueAdapter.enqueueTimer(String(action.payload.id), runAt);
    } else {
      runtime.logger.warn?.({ jobType: action.jobType, payload: action.payload }, "unknown enqueue_job action");
    }
    return true;
  }

  if (action.kind === "noop") {
    return true;
  }

  if (action.kind === "handoff") {
    const note = action.note ?? "Handoff solicitado.";
    await sendTextAndPersist({
      runtime,
      to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
      text: note,
      actionName: "handoff",
      scope: runtime.isGroup ? "group" : "direct",
      responseActionId
    });
    return true;
  }

  if (action.kind === "ai_tool_suggestion") {
    const textToSend =
      action.text ??
      `Posso executar: ${action.tool.action}. Diga 'ok' para confirmar ou detalhe o que precisa.`;
    await sendTextAndPersist({
      runtime,
      to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
      text: textToSend,
      actionName: "ai_tool_suggestion",
      scope: runtime.isGroup ? "group" : "direct",
      responseActionId
    });
    return true;
  }

  if (action.kind === "reply_audio") {
    let audioBuffer: Buffer;
    const audioLogBase = {
      capability: action.capability ?? "tts",
      responseActionId,
      tenantId: runtime.event.tenantId,
      waGroupId: runtime.event.waGroupId,
      waUserId: runtime.waUserId,
      inboundWaMessageId: runtime.event.waMessageId,
      executionId: runtime.event.executionId
    };

    try {
      audioBuffer = Buffer.from(action.audioBase64, "base64");
    } catch {
      if (action.ptt) {
        runtime.logger.info?.(
          runtime.withCategory("WA-OUT", {
            action: "send_ptt",
            status: "failure",
            reason: "invalid_base64",
            ...audioLogBase
          }),
          "voice message failed"
        );
      }
      await sendTextAndPersist({
        runtime,
        to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
        text: "Falha ao preparar áudio para envio.",
        actionName: "reply_audio_error",
        scope: runtime.isGroup ? "group" : "direct",
        responseActionId
      });
      return true;
    }

    if (!audioBuffer.length) {
      if (action.ptt) {
        runtime.logger.info?.(
          runtime.withCategory("WA-OUT", {
            action: "send_ptt",
            status: "failure",
            reason: "empty_audio_payload",
            ...audioLogBase
          }),
          "voice message failed"
        );
      }
      await sendTextAndPersist({
        runtime,
        to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
        text: "Áudio TTS vazio. Tente novamente em instantes.",
        actionName: "reply_audio_error",
        scope: runtime.isGroup ? "group" : "direct",
        responseActionId
      });
      return true;
    }

    const requestedMimeType = typeof action.mimeType === "string" && action.mimeType.trim() ? action.mimeType.trim() : "application/octet-stream";
    let outboundAudioBuffer = audioBuffer;
    let outboundMimeType = requestedMimeType;
    let outboundPtt = Boolean(action.ptt);
    let inputProbe = inspectAudioPayload({ audioBuffer, mimeType: requestedMimeType });
    let outputProbe = inputProbe;
    let transcodeReason: string | undefined;
    let transcodedToPtt = false;

    if (action.ptt) {
      try {
        const pttAudio = await transcodeToWhatsAppPtt({
          audioBuffer,
          mimeType: requestedMimeType
        });
        outboundAudioBuffer = pttAudio.audioBuffer;
        outboundMimeType = pttAudio.mimeType;
        outboundPtt = true;
        transcodedToPtt = pttAudio.transcoded;
        inputProbe = pttAudio.inputProbe;
        outputProbe = inspectAudioPayload({ audioBuffer: outboundAudioBuffer, mimeType: outboundMimeType });
      } catch (error) {
        outboundPtt = false;
        transcodeReason = normalizeErrorReason(error, "ptt_transcode_failed");
        outputProbe = inspectAudioPayload({ audioBuffer: outboundAudioBuffer, mimeType: outboundMimeType });
        runtime.logger.warn?.(
          runtime.withCategory("WA-OUT", {
            action: "send_ptt",
            status: "fallback_audio",
            reason: transcodeReason,
            requestedMimeType,
            requestedPtt: true,
            finalPtt: false,
            inputContainer: inputProbe.container,
            inputCodecGuess: inputProbe.codecGuess,
            inputBytes: inputProbe.byteLength,
            ...audioLogBase
          }),
          "voice message transcoding failed; sending standard audio instead"
        );
      }
    }

    await sendTextAndPersist({
      runtime,
      to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
      text: action.caption ?? "[audio]",
      actionName: "reply_audio",
      scope: runtime.isGroup ? "group" : "direct",
      responseActionId,
      content: {
        audio: outboundAudioBuffer,
        mimetype: outboundMimeType,
        ptt: outboundPtt,
        fileName: action.fileName
      }
    });

    if (action.ptt) {
      const actionName = outboundPtt ? "send_ptt" : "send_audio_fallback";
      const status = outboundPtt ? "success" : "fallback";
      const logMessage = outboundPtt ? "voice message sent" : "voice note sent as regular audio fallback";
      runtime.logger.info?.(
        runtime.withCategory("WA-OUT", {
          action: actionName,
          status,
          requestedPtt: true,
          finalPtt: outboundPtt,
          requestedMimeType,
          finalMimeType: outboundMimeType,
          inputContainer: inputProbe.container,
          inputCodecGuess: inputProbe.codecGuess,
          outputContainer: outputProbe.container,
          outputCodecGuess: outputProbe.codecGuess,
          outputBytes: outputProbe.byteLength,
          transcodedToPtt,
          transcodeReason,
          ...audioLogBase
        }),
        logMessage
      );
    }

    return true;
  }

  if (action.kind === "reply_image") {
    const target = runtime.isGroup ? runtime.remoteJid : runtime.waUserId;
    const scope: "group" | "direct" = runtime.isGroup ? "group" : "direct";
    const imageUrl = typeof action.imageUrl === "string" ? action.imageUrl.trim() : "";
    const fallbackText =
      typeof action.fallbackText === "string" && action.fallbackText.trim()
        ? action.fallbackText.trim()
        : "Nao consegui enviar a imagem agora. Tente novamente em instantes.";
    const imageLogBase = {
      capability: "image-send",
      responseActionId,
      tenantId: runtime.event.tenantId,
      waGroupId: runtime.event.waGroupId,
      waUserId: runtime.waUserId,
      inboundWaMessageId: runtime.event.waMessageId,
      executionId: runtime.event.executionId,
      imageUrlPreview: imageUrl ? imageUrl.slice(0, 180) : undefined
    };
    const baseSendInput = {
      runtime,
      to: target,
      text: typeof action.caption === "string" && action.caption.trim() ? action.caption : imageUrl || "[imagem]",
      actionName: "reply_image",
      scope,
      responseActionId
    };

    let imageBuffer: Buffer | null = null;
    let imageMimeType = "image/jpeg";
    let failureReason = "image_unavailable";

    if (typeof action.imageBase64 === "string" && action.imageBase64.trim()) {
      try {
        const decoded = Buffer.from(action.imageBase64, "base64");
        if (!decoded.length) {
          failureReason = "empty_inline_image_payload";
        } else if (decoded.length > IMAGE_FETCH_MAX_BYTES) {
          failureReason = "inline_image_payload_too_large";
        } else {
          imageBuffer = decoded;
          imageMimeType = typeof action.mimeType === "string" && action.mimeType.trim() ? action.mimeType.trim() : imageMimeType;
        }
      } catch (error) {
        failureReason = normalizeErrorReason(error, "invalid_inline_image_payload");
      }
    }

    if (!imageBuffer && imageUrl) {
      runtime.logger.info?.(
        runtime.withCategory("WA-OUT", {
          action: "reply_image",
          status: "download_started",
          ...imageLogBase
        }),
        "media download started"
      );

      const downloaded = await fetchImageBuffer(imageUrl);
      if (downloaded.ok) {
        imageBuffer = downloaded.buffer;
        imageMimeType = downloaded.mimeType;
        runtime.logger.info?.(
          runtime.withCategory("WA-OUT", {
            action: "reply_image",
            status: "download_success",
            mimeType: downloaded.mimeType,
            byteLength: downloaded.byteLength,
            httpStatus: downloaded.httpStatus,
            ...imageLogBase
          }),
          "media download success"
        );
      } else {
        failureReason = downloaded.reason;
        runtime.logger.info?.(
          runtime.withCategory("WA-OUT", {
            action: "reply_image",
            status: "download_failure",
            reason: downloaded.reason,
            mimeType: downloaded.mimeType,
            byteLength: downloaded.byteLength,
            httpStatus: downloaded.httpStatus,
            ...imageLogBase
          }),
          "media download failure"
        );
      }
    }

    if (!imageBuffer && !imageUrl) {
      failureReason = "missing_image_source";
    }

    if (imageBuffer) {
      try {
        await sendTextAndPersist({
          ...baseSendInput,
          content: {
            image: imageBuffer,
            mimetype: imageMimeType,
            caption: action.caption
          }
        });
        return true;
      } catch (error) {
        failureReason = normalizeErrorReason(error, "send_image_failed");
        runtime.logger.warn?.(
          runtime.withCategory("WA-OUT", {
            action: "reply_image",
            status: "send_failure",
            reason: failureReason,
            err: error,
            ...imageLogBase
          }),
          "reply image send failed"
        );
      }
    }

    runtime.logger.info?.(
      runtime.withCategory("WA-OUT", {
        action: "reply_image",
        status: "fallback_text",
        reason: failureReason,
        fallbackTextPreview: fallbackText.slice(0, 120),
        ...imageLogBase
      }),
      "reply-image fallback to text"
    );

    try {
      await sendTextAndPersist({
        runtime,
        to: target,
        text: fallbackText,
        actionName: "reply_image_fallback_text",
        scope,
        responseActionId
      });
    } catch (fallbackError) {
      runtime.logger.warn?.(
        runtime.withCategory("WA-OUT", {
          action: "reply_image",
          status: "fallback_text_failure",
          reason: normalizeErrorReason(fallbackError, "fallback_text_send_failed"),
          err: fallbackError,
          ...imageLogBase
        }),
        "reply-image fallback text failed"
      );
    }
    return true;
  }

  if (action.kind === "reply_text" || action.kind === "reply_list") {
    const textToSend =
      action.kind === "reply_text"
        ? action.text
        : [action.header, ...action.items.map((item: any) => `• ${item.title}${item.description ? ` — ${item.description}` : ""}`), action.footer]
            .filter(Boolean)
            .join("\n");
    await sendTextAndPersist({
      runtime,
      to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
      text: textToSend,
      actionName: action.kind,
      scope: runtime.isGroup ? "group" : "direct",
      responseActionId
    });
    return true;
  }

  return false;
};
