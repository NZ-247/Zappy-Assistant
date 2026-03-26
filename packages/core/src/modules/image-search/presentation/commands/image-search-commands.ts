import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import { parseImageSearchCommand } from "../../infrastructure/image-search-command-parser.js";
import { executeImageSearch, type ImageSearchExecutionMode, type ImageSearchUseCaseConfig } from "../../application/use-cases/search-images.js";
import type { ImageSearchPort } from "../../ports.js";

export interface ImageSearchCommandDeps {
  imageSearch?: ImageSearchPort;
  config: ImageSearchUseCaseConfig;
  formatUsage?: (command: "img" | "gimage" | "imglink") => string | null;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}

const handledCommands = new Set(["img", "gimage", "imglink"]);

const parseFailureMessage = (input: {
  reason: "missing_query" | "incompatible_reply";
  usage: string;
}): string => {
  if (input.reason === "incompatible_reply") {
    return `Esse comando usa texto. Responda uma mensagem de texto ou informe o termo.\n${input.usage}`;
  }
  return input.usage;
};

export const handleImageSearchCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: ImageSearchCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps } = input;
  if (!handledCommands.has(commandKey)) return null;
  const mode: ImageSearchExecutionMode = commandKey === "imglink" ? "media_or_links" : "media";

  const parsed = parseImageSearchCommand(cmd, {
    replyContext: {
      quotedWaMessageId: ctx.event.quotedWaMessageId,
      quotedMessageType: ctx.event.quotedMessageType,
      quotedText: ctx.event.quotedText,
      quotedHasMedia: ctx.event.quotedHasMedia
    }
  });

  if (!parsed.ok) {
    const usage = deps.formatUsage?.(commandKey as "img" | "gimage" | "imglink") ?? "Uso correto: img <termo da busca>";
    const text = parseFailureMessage({ reason: parsed.reason, usage });
    const formatted = deps.stylizeReply ? deps.stylizeReply(text) : text;
    return [{ kind: "reply_text", text: formatted }];
  }

  return executeImageSearch({
    tenantId: ctx.event.tenantId,
    query: parsed.query,
    imageSearch: deps.imageSearch,
    config: deps.config,
    mode,
    stylizeReply: deps.stylizeReply,
    logger: deps.logger
  });
};
