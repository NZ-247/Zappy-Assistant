import { sendTextAndPersist } from "../context.js";
import type { ExecuteOutboundActionsInput } from "../types.js";
import { AudioTranscodingError, inspectAudioPayload, transcodeToWhatsAppPtt } from "./wa-audio-transcoding.js";

const IMAGE_FETCH_TIMEOUT_MS = 12_000;
const IMAGE_FETCH_MAX_BYTES = 8 * 1024 * 1024;

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeErrorReason = (error: unknown, fallback = "unknown_error"): string => {
  if (error instanceof AudioTranscodingError) return error.reason;
  if (error instanceof Error) {
    const message = normalizeText(error.message);
    return message || fallback;
  }
  return fallback;
};

const fetchImageBuffer = async (imageUrl: string): Promise<{ buffer: Buffer; mimeType: string } | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "zappy-assistant/1.5 (+wa-gateway-image-send)"
      },
      signal: controller.signal
    });
    if (!response.ok) return null;

    const mimeType = normalizeText(response.headers.get("content-type") || "").toLowerCase();
    if (!mimeType.startsWith("image/")) return null;

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > IMAGE_FETCH_MAX_BYTES) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > IMAGE_FETCH_MAX_BYTES) return null;
    return { buffer: bytes, mimeType };
  } catch {
    return null;
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
    const imageUrl = typeof action.imageUrl === "string" ? action.imageUrl.trim() : "";
    if (!imageUrl) {
      await sendTextAndPersist({
        runtime,
        to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
        text: "Falha ao preparar imagem para envio.",
        actionName: "reply_image_error",
        scope: runtime.isGroup ? "group" : "direct",
        responseActionId
      });
      return true;
    }

    const bufferedImage = await fetchImageBuffer(imageUrl);
    const baseSendInput = {
      runtime,
      to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
      text: action.caption ?? imageUrl,
      actionName: "reply_image",
      scope: runtime.isGroup ? "group" as const : "direct" as const,
      responseActionId
    };

    if (bufferedImage) {
      try {
        await sendTextAndPersist({
          ...baseSendInput,
          content: {
            image: bufferedImage.buffer,
            mimetype: bufferedImage.mimeType,
            caption: action.caption
          }
        });
        return true;
      } catch {
        // fallback para URL abaixo
      }
    }

    await sendTextAndPersist({
      ...baseSendInput,
      content: {
        image: { url: imageUrl },
        caption: action.caption
      }
    });
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
