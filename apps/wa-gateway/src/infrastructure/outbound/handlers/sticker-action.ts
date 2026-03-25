import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildActionLogContext, logOutbound, sendTextAndPersist } from "../context.js";
import { createProgressReactionLifecycle } from "../reaction-progress.js";
import type { ExecuteOutboundActionsInput, OutboundScope } from "../types.js";

type StickerRuntimeAction = {
  kind: "sticker_transform";
  operation: "media_to_sticker" | "image_to_sticker" | "sticker_to_image" | "sticker_rename_metadata";
  source: "inbound" | "quoted";
  sourceMediaType?: "image" | "video";
  author?: string;
  packName?: string;
};

type StickerCapabilityAction = "generate" | "toimg" | "rename_metadata";
type StickerLogMediaType = "image" | "video" | "sticker";
type MessageMediaTypeKey = "imageMessage" | "videoMessage" | "stickerMessage";

type ResolvedMediaSource = {
  payload: any;
  mediaType: StickerLogMediaType;
  videoDurationSeconds?: number;
};

class StickerCapabilityError extends Error {
  readonly reason: string;
  readonly userMessage: string;

  constructor(input: { reason: string; userMessage: string }) {
    super(input.reason);
    this.reason = input.reason;
    this.userMessage = input.userMessage;
  }
}

let sharpLoader: Promise<(input: Buffer | Uint8Array) => any> | null = null;
const loadSharp = async () => {
  if (!sharpLoader) {
    sharpLoader = import("sharp").then((module) => module.default);
  }
  return sharpLoader;
};

let webpMuxLoader: Promise<{ Image: new () => { load: (input: Buffer) => Promise<void>; save: (path?: string | null) => Promise<Buffer>; exif?: Buffer } } | null> | null =
  null;
const loadWebpMux = async () => {
  if (!webpMuxLoader) {
    webpMuxLoader = import("node-webpmux")
      .then((module) => {
        const target = (module.default ?? module) as { Image?: new () => any };
        if (!target?.Image) return null;
        return target as { Image: new () => { load: (input: Buffer) => Promise<void>; save: (path?: string | null) => Promise<Buffer>; exif?: Buffer } };
      })
      .catch(() => null);
  }
  return webpMuxLoader;
};

const buildStickerExif = (input: { author: string; packName?: string }): Buffer => {
  const payload = {
    "sticker-pack-id": "com.zappy.assistant.stickers",
    "sticker-pack-name": input.packName?.trim() || "Zappy Stickers",
    "sticker-pack-publisher": input.author.trim(),
    emojis: ["🤖"]
  };
  const json = Buffer.from(JSON.stringify(payload), "utf-8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length, 0);
  return Buffer.concat([
    Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]),
    length,
    Buffer.from([0x16, 0x00, 0x00, 0x00]),
    json
  ]);
};

const attachStickerMetadata = async (buffer: Buffer, input: { author?: string; packName?: string }): Promise<Buffer> => {
  const author = input.author?.trim();
  if (!author) return buffer;

  const mux = await loadWebpMux();
  if (!mux?.Image) return buffer;

  try {
    const image = new mux.Image();
    await image.load(buffer);
    image.exif = buildStickerExif({ author, packName: input.packName?.trim() });
    return image.save(null);
  } catch {
    return buffer;
  }
};

const renameStickerMetadata = async (buffer: Buffer, input: { author?: string; packName?: string }): Promise<Buffer> => {
  const author = input.author?.trim();
  const packName = input.packName?.trim();
  if (!author || !packName) {
    throw new StickerCapabilityError({
      reason: "invalid_metadata",
      userMessage: "Uso correto: /rnfig Autor|Pacote respondendo uma figurinha."
    });
  }

  const mux = await loadWebpMux();
  if (!mux?.Image) {
    throw new StickerCapabilityError({
      reason: "metadata_adapter_unavailable",
      userMessage: "Não consegui renomear metadados agora. Tente novamente em instantes."
    });
  }

  const image = new mux.Image();
  try {
    await image.load(buffer);
  } catch {
    throw new StickerCapabilityError({
      reason: "invalid_sticker_media",
      userMessage: "Não consegui ler essa figurinha. Responda uma figurinha válida."
    });
  }

  image.exif = buildStickerExif({ author, packName });
  try {
    return await image.save(null);
  } catch {
    throw new StickerCapabilityError({
      reason: "metadata_write_failed",
      userMessage: "Não consegui atualizar os metadados dessa figurinha agora."
    });
  }
};

const convertImageToSticker = async (buffer: Buffer): Promise<Buffer> => {
  try {
    const sharp = await loadSharp();
    return await sharp(buffer)
      .rotate()
      .resize(512, 512, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new StickerCapabilityError({
      reason: "invalid_image_media",
      userMessage: "Não consegui processar essa imagem. Envie uma imagem válida para gerar figurinha."
    });
  }
};

const convertStickerToImage = async (buffer: Buffer): Promise<Buffer> => {
  try {
    const sharp = await loadSharp();
    return await sharp(buffer)
      .rotate()
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new StickerCapabilityError({
      reason: "invalid_sticker_media",
      userMessage: "Essa figurinha não pôde ser convertida. Responda uma figurinha válida."
    });
  }
};

const runCommand = async (input: {
  command: "ffmpeg" | "ffprobe";
  args: string[];
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    const proc = spawn(input.command, input.args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(
        new StickerCapabilityError({
          reason: `${input.command}_timeout`,
          userMessage: "A conversão de mídia demorou além do esperado. Tente novamente com mídia menor."
        })
      );
    }, input.timeoutMs);

    proc.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    proc.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    proc.once("error", (error) => {
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reject(
          new StickerCapabilityError({
            reason: `${input.command}_not_found`,
            userMessage:
              input.command === "ffmpeg"
                ? "Não consigo converter vídeo agora porque o ffmpeg não está disponível neste host."
                : "Não consegui validar a duração do vídeo porque o ffprobe não está disponível neste host."
          })
        );
        return;
      }
      reject(error);
    });

    proc.once("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${input.command}_failed_${code ?? "unknown"}:${stderr || stdout}`));
    });
  });
};

const probeVideoDurationSeconds = async (inputPath: string): Promise<number> => {
  try {
    const { stdout } = await runCommand({
      command: "ffprobe",
      timeoutMs: 8_000,
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputPath
      ]
    });
    const duration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new StickerCapabilityError({
        reason: "invalid_video_duration",
        userMessage: "Não consegui validar a duração do vídeo. Envie um vídeo curto válido."
      });
    }
    return duration;
  } catch (error) {
    if (error instanceof StickerCapabilityError) throw error;
    throw new StickerCapabilityError({
      reason: "video_duration_probe_failed",
      userMessage: "Não consegui validar a duração desse vídeo. Envie um vídeo curto válido."
    });
  }
};

const safeCleanupDir = async (path: string): Promise<void> => {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch {
    // noop
  }
};

const convertVideoToSticker = async (buffer: Buffer, input: { maxVideoSeconds: number; hintedDurationSeconds?: number }): Promise<Buffer> => {
  const maxVideoSeconds = Math.max(1, Math.trunc(input.maxVideoSeconds));
  const hintedDuration =
    input.hintedDurationSeconds !== undefined && Number.isFinite(input.hintedDurationSeconds) && input.hintedDurationSeconds > 0
      ? input.hintedDurationSeconds
      : undefined;

  if (hintedDuration !== undefined && hintedDuration > maxVideoSeconds) {
    throw new StickerCapabilityError({
      reason: "video_duration_exceeded",
      userMessage: `Vídeo muito longo. O limite atual para figurinha é ${maxVideoSeconds}s.`
    });
  }

  const tempDir = await fs.mkdtemp(join(tmpdir(), "zappy-sticker-"));
  const inputPath = join(tempDir, "input.mp4");
  const outputPath = join(tempDir, "output.webp");

  try {
    await fs.writeFile(inputPath, buffer);

    const duration = hintedDuration ?? (await probeVideoDurationSeconds(inputPath));
    if (duration > maxVideoSeconds) {
      throw new StickerCapabilityError({
        reason: "video_duration_exceeded",
        userMessage: `Vídeo muito longo. O limite atual para figurinha é ${maxVideoSeconds}s.`
      });
    }

    const filter = "scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=12";

    await runCommand({
      command: "ffmpeg",
      timeoutMs: 20_000,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-an",
        "-t",
        String(maxVideoSeconds),
        "-vf",
        filter,
        "-loop",
        "0",
        "-vcodec",
        "libwebp_anim",
        "-q:v",
        "65",
        "-compression_level",
        "6",
        "-preset",
        "picture",
        "-metadata:s:v:0",
        "alpha_mode=1",
        outputPath
      ]
    });

    const output = await fs.readFile(outputPath);
    if (!output.length) {
      throw new StickerCapabilityError({
        reason: "empty_video_conversion",
        userMessage: "Não consegui gerar figurinha deste vídeo. Tente com outro vídeo curto."
      });
    }

    return output;
  } catch (error) {
    if (error instanceof StickerCapabilityError) throw error;
    throw new StickerCapabilityError({
      reason: "video_conversion_failed",
      userMessage: "Não consegui converter esse vídeo em figurinha agora. Tente outro vídeo curto."
    });
  } finally {
    await safeCleanupDir(tempDir);
  }
};

const normalizeMessageType = (message: any): string => {
  if (!message || typeof message !== "object") return "";
  const key = Object.keys(message)[0];
  return typeof key === "string" ? key : "";
};

const extractVideoDurationSeconds = (message: any): number | undefined => {
  const rawSeconds = message?.videoMessage?.seconds;
  const seconds = typeof rawSeconds === "number" ? rawSeconds : Number(rawSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return seconds;
};

const mapMessageTypeToLogMedia = (type: MessageMediaTypeKey): StickerLogMediaType => {
  if (type === "imageMessage") return "image";
  if (type === "videoMessage") return "video";
  return "sticker";
};

const resolveCapabilityAction = (action: StickerRuntimeAction): StickerCapabilityAction => {
  if (action.operation === "sticker_to_image") return "toimg";
  if (action.operation === "sticker_rename_metadata") return "rename_metadata";
  return "generate";
};

const resolveExpectedLogMedia = (action: StickerRuntimeAction): StickerLogMediaType => {
  const capabilityAction = resolveCapabilityAction(action);
  if (capabilityAction === "toimg" || capabilityAction === "rename_metadata") return "sticker";
  return action.sourceMediaType === "video" ? "video" : "image";
};

const resolveExpectedMessageTypes = (action: StickerRuntimeAction): MessageMediaTypeKey[] => {
  const capabilityAction = resolveCapabilityAction(action);
  if (capabilityAction === "toimg" || capabilityAction === "rename_metadata") return ["stickerMessage"];
  if (action.sourceMediaType === "image") return ["imageMessage"];
  if (action.sourceMediaType === "video") return ["videoMessage"];
  return ["imageMessage", "videoMessage"];
};

const resolveMediaSource = (runtime: ExecuteOutboundActionsInput, action: StickerRuntimeAction): ResolvedMediaSource | null => {
  const expectedTypes = resolveExpectedMessageTypes(action);

  if (action.source === "inbound") {
    const message = runtime.message?.message;
    if (!message || typeof message !== "object") return null;
    for (const expectedType of expectedTypes) {
      if (message[expectedType]) {
        return {
          payload: runtime.message,
          mediaType: mapMessageTypeToLogMedia(expectedType),
          videoDurationSeconds: expectedType === "videoMessage" ? extractVideoDurationSeconds(message) : undefined
        };
      }
    }
    return null;
  }

  const quoted = runtime.contextInfo?.quotedMessage;
  const quotedType = normalizeMessageType(quoted);
  const expected = expectedTypes.find((candidate) => candidate === quotedType);
  if (!quoted || !expected) return null;

  const quotedKey = {
    remoteJid: runtime.remoteJid,
    id: runtime.quotedWaMessageId ?? runtime.event.quotedWaMessageId ?? runtime.message?.key?.id ?? `${Date.now()}`,
    fromMe: false,
    participant: runtime.quotedWaUserId ?? runtime.event.quotedWaUserId ?? undefined
  };

  return {
    payload: { key: quotedKey, message: quoted },
    mediaType: mapMessageTypeToLogMedia(expected),
    videoDurationSeconds: expected === "videoMessage" ? extractVideoDurationSeconds(quoted) : undefined
  };
};

const capabilityLogBase = (runtime: ExecuteOutboundActionsInput, action: StickerRuntimeAction, mediaType: StickerLogMediaType, responseActionId: string) => ({
  tenantId: runtime.event.tenantId,
  waGroupId: runtime.event.waGroupId,
  waUserId: runtime.waUserId,
  inboundWaMessageId: runtime.event.waMessageId,
  executionId: runtime.event.executionId,
  responseActionId,
  capability: "stickers",
  action: resolveCapabilityAction(action),
  source: action.source,
  mediaType
});

const friendlyStickerError = (action: StickerRuntimeAction): string => {
  const capabilityAction = resolveCapabilityAction(action);
  if (capabilityAction === "generate") {
    return "Não encontrei imagem/vídeo válido. Responda a mídia correta ou envie com legenda /sticker.";
  }
  if (capabilityAction === "rename_metadata") {
    return "Não encontrei figurinha válida. Responda um sticker para usar /rnfig.";
  }
  return "Não encontrei figurinha válida. Responda um sticker para usar /toimg.";
};

const resolveActionRuntimeName = (action: StickerRuntimeAction): { actionName: string; persistText: string } => {
  const capabilityAction = resolveCapabilityAction(action);
  if (capabilityAction === "generate") {
    return { actionName: "sticker_generate", persistText: "[figurinha gerada]" };
  }
  if (capabilityAction === "rename_metadata") {
    return { actionName: "sticker_rename_metadata", persistText: "[metadados da figurinha atualizados]" };
  }
  return { actionName: "sticker_to_image", persistText: "[figurinha convertida para imagem]" };
};

const buildTransformContent = async (input: {
  runtime: ExecuteOutboundActionsInput;
  action: StickerRuntimeAction;
  source: ResolvedMediaSource;
  mediaBuffer: Buffer;
}): Promise<any> => {
  const { runtime, action, source, mediaBuffer } = input;
  const capabilityAction = resolveCapabilityAction(action);

  if (capabilityAction === "toimg") {
    return { image: await convertStickerToImage(mediaBuffer), mimetype: "image/png" };
  }

  if (capabilityAction === "rename_metadata") {
    return {
      sticker: await renameStickerMetadata(mediaBuffer, {
        author: action.author,
        packName: action.packName
      })
    };
  }

  if (source.mediaType === "video") {
    const videoSticker = await convertVideoToSticker(mediaBuffer, {
      maxVideoSeconds: runtime.stickerMaxVideoSeconds,
      hintedDurationSeconds: source.videoDurationSeconds
    });
    return {
      sticker: await attachStickerMetadata(videoSticker, {
        author: action.author,
        packName: action.packName
      })
    };
  }

  if (source.mediaType === "image") {
    const imageSticker = await convertImageToSticker(mediaBuffer);
    return {
      sticker: await attachStickerMetadata(imageSticker, {
        author: action.author,
        packName: action.packName
      })
    };
  }

  throw new StickerCapabilityError({
    reason: "invalid_generate_media_type",
    userMessage: "Mídia inválida para gerar figurinha. Use imagem ou vídeo curto."
  });
};

const normalizeFailure = (error: unknown): { reason: string; userMessage: string } => {
  if (error instanceof StickerCapabilityError) {
    return { reason: error.reason, userMessage: error.userMessage };
  }

  return {
    reason: "conversion_or_send_failed",
    userMessage: "Não consegui processar a mídia agora. Tente novamente com outra imagem/vídeo/figurinha."
  };
};

export const handleStickerOutboundAction = async (input: {
  runtime: ExecuteOutboundActionsInput;
  action: any;
  responseActionId: string;
}): Promise<boolean> => {
  const { runtime, action, responseActionId } = input;
  if (action.kind !== "sticker_transform") return false;

  const scope: OutboundScope = runtime.isGroup ? "group" : "direct";
  const target = runtime.isGroup ? runtime.remoteJid : runtime.waUserId;
  const typedAction = action as StickerRuntimeAction;
  const socket = runtime.getSocket();
  if (!socket) {
    await sendTextAndPersist({
      runtime,
      to: target,
      text: "Socket indisponível no momento. Tente novamente em instantes.",
      actionName: "sticker_transform_error",
      scope,
      responseActionId
    });
    return true;
  }
  const progress = createProgressReactionLifecycle({
    runtime,
    responseActionId,
    actionName: "sticker_transform"
  });
  await progress.start();

  const source = resolveMediaSource(runtime, typedAction);
  if (!source) {
    await progress.failure();
    await sendTextAndPersist({
      runtime,
      to: target,
      text: friendlyStickerError(typedAction),
      actionName: "sticker_transform_error",
      scope,
      responseActionId
    });
    runtime.logger.info?.(
      runtime.withCategory("WA-OUT", {
        ...capabilityLogBase(runtime, typedAction, resolveExpectedLogMedia(typedAction), responseActionId),
        status: "failure",
        reason: "invalid_source_media"
      }),
      "stickers capability"
    );
    return true;
  }

  try {
    const sock = socket as any;
    const reuploadRequest = typeof sock.updateMediaMessage === "function" ? sock.updateMediaMessage.bind(sock) : undefined;
    const downloadedMedia = await runtime.downloadMediaMessage(
      source.payload,
      "buffer",
      {},
      { logger: runtime.baileysLogger, reuploadRequest }
    );
    const mediaBuffer = Buffer.isBuffer(downloadedMedia) ? downloadedMedia : Buffer.from(downloadedMedia as Uint8Array);

    const { actionName, persistText } = resolveActionRuntimeName(typedAction);
    const content = await buildTransformContent({
      runtime,
      action: typedAction,
      source,
      mediaBuffer
    });

    const sent = await runtime.sendWithReplyFallback({
      to: target,
      content,
      quotedMessage: runtime.message,
      logContext: buildActionLogContext(runtime, actionName, scope, responseActionId)
    });

    await runtime.persistOutboundMessage({
      tenantId: runtime.context.tenant.id,
      userId: runtime.context.user.id,
      groupId: runtime.context.group?.id,
      waUserId: runtime.waUserId,
      waGroupId: runtime.event.waGroupId,
      text: persistText,
      waMessageId: sent?.key?.id,
      rawJson: sent
    });

    if (sent?.key?.id) {
      logOutbound(runtime, actionName, sent.key.id, persistText, scope, responseActionId);
    }

    runtime.logger.info?.(
      runtime.withCategory("WA-OUT", {
        ...capabilityLogBase(runtime, typedAction, source.mediaType, responseActionId),
        status: "success"
      }),
      "stickers capability"
    );
    await progress.success();
  } catch (error) {
    await progress.failure();
    const failure = normalizeFailure(error);
    runtime.logger.warn?.(
      runtime.withCategory("WA-OUT", {
        ...capabilityLogBase(runtime, typedAction, source.mediaType, responseActionId),
        status: "failure",
        reason: failure.reason,
        err: error
      }),
      "stickers capability"
    );

    await sendTextAndPersist({
      runtime,
      to: target,
      text: failure.userMessage,
      actionName: "sticker_transform_error",
      scope,
      responseActionId
    });
  }

  return true;
};
