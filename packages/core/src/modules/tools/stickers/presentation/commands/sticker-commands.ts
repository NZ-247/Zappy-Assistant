import type { PipelineContext } from "../../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../../pipeline/actions.js";
import {
  buildMediaToStickerAction,
  buildRenameStickerMetadataAction,
  buildStickerToImageAction
} from "../../application/use-cases/build-sticker-transform-action.js";
import type { StickerCommandMetadata, StickerModuleConfigPort } from "../../ports.js";

const normalizeMessageType = (value?: string): string => (value ?? "").trim().toLowerCase();
const isImageMessageType = (value: string): boolean => value === "imagemessage";
const isVideoMessageType = (value: string): boolean => value === "videomessage";
const isStickerMessageType = (value: string): boolean => value === "stickermessage";

const parseStickerMetadata = (rawArgs: string, config: StickerModuleConfigPort): StickerCommandMetadata => {
  if (!rawArgs) {
    return {
      author: config.defaultAuthor,
      packName: config.defaultPackName
    };
  }

  const [rawAuthor, rawPack] = rawArgs.split("|", 2).map((item) => item.trim());
  const author = rawAuthor || config.defaultAuthor;
  const packName = rawPack || config.defaultPackName;
  return { author, packName };
};

const parseRenameStickerMetadata = (rawArgs: string): StickerCommandMetadata | null => {
  const parts = rawArgs.split("|").map((item) => item.trim());
  if (parts.length !== 2) return null;
  const [author, packName] = parts;
  if (!author || !packName) return null;
  return { author, packName };
};

const parseCommandArgs = (cmd: string): string => cmd.replace(/^\S+\s*/u, "").trim();

export interface StickerCommandDeps {
  config: StickerModuleConfigPort;
  formatUsage?: (command: "sticker" | "toimg" | "rnfig") => string | null;
  stylizeReply?: (text: string) => string;
}

const replyText = (deps: StickerCommandDeps, text: string): ResponseAction[] => {
  const formatted = deps.stylizeReply ? deps.stylizeReply(text) : text;
  return [{ kind: "reply_text", text: formatted }];
};

export const handleStickerCommand = (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: StickerCommandDeps;
}): ResponseAction[] | null => {
  const { commandKey, cmd, ctx, deps } = input;
  const inboundType = normalizeMessageType(ctx.event.rawMessageType);
  const quotedType = normalizeMessageType(ctx.event.quotedMessageType);
  const hasQuoted = Boolean(ctx.event.quotedWaMessageId);

  if (commandKey === "sticker") {
    const metadata = parseStickerMetadata(parseCommandArgs(cmd), deps.config);
    if (isImageMessageType(inboundType)) {
      return [buildMediaToStickerAction({ source: "inbound", mediaType: "image", ...metadata })];
    }
    if (isVideoMessageType(inboundType)) {
      return [buildMediaToStickerAction({ source: "inbound", mediaType: "video", ...metadata })];
    }
    if (hasQuoted) {
      if (isImageMessageType(quotedType)) {
        return [buildMediaToStickerAction({ source: "quoted", mediaType: "image", ...metadata })];
      }
      if (isVideoMessageType(quotedType)) {
        return [buildMediaToStickerAction({ source: "quoted", mediaType: "video", ...metadata })];
      }
      return replyText(deps, "Responda uma imagem ou vídeo curto para usar este comando.");
    }
    const usage = deps.formatUsage?.("sticker");
    return replyText(deps, usage ?? "Uso correto: sticker [Autor|Nome_Pacote] respondendo ou enviando uma imagem/vídeo curto.");
  }

  if (commandKey === "toimg") {
    if (!hasQuoted) {
      const usage = deps.formatUsage?.("toimg");
      return replyText(deps, usage ?? "Uso correto: toimg respondendo um sticker.");
    }
    if (!isStickerMessageType(quotedType)) {
      return replyText(deps, "Este comando funciona apenas respondendo a uma figurinha válida.");
    }
    return [buildStickerToImageAction({ source: "quoted" })];
  }

  if (commandKey === "rnfig") {
    const metadata = parseRenameStickerMetadata(parseCommandArgs(cmd));
    if (!metadata) {
      const usage = deps.formatUsage?.("rnfig");
      return replyText(deps, usage ?? "Uso correto: rnfig Autor|Pacote respondendo um sticker.");
    }
    if (!hasQuoted || !isStickerMessageType(quotedType)) {
      return replyText(deps, "Responda a uma figurinha válida para renomear autor e pacote.");
    }
    return [buildRenameStickerMetadataAction({ source: "quoted", ...metadata })];
  }

  return null;
};
