import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import { parseWebSearchCommand } from "../../infrastructure/web-search-command-parser.js";
import { executeWebSearch, type WebSearchUseCaseConfig } from "../../application/use-cases/search-web.js";
import type { WebSearchPort } from "../../ports.js";

export interface WebSearchCommandDeps {
  search?: WebSearchPort;
  config: WebSearchUseCaseConfig;
  formatUsage?: (command: "search" | "google") => string | null;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}

const handledCommands = new Set(["search", "google"]);

const parseFailureMessage = (input: {
  reason: "missing_query" | "incompatible_reply";
  usage: string;
}): string => {
  if (input.reason === "incompatible_reply") {
    return `Esse comando usa texto. Responda uma mensagem de texto ou informe o termo.\n${input.usage}`;
  }
  return input.usage;
};

export const handleWebSearchCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: WebSearchCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps } = input;
  if (!handledCommands.has(commandKey)) return null;
  const commandKind = commandKey as "search" | "google";

  const parsed = parseWebSearchCommand(cmd, {
    replyContext: {
      quotedWaMessageId: ctx.event.quotedWaMessageId,
      quotedMessageType: ctx.event.quotedMessageType,
      quotedText: ctx.event.quotedText,
      quotedHasMedia: ctx.event.quotedHasMedia
    }
  });

  if (!parsed.ok) {
    const usage = deps.formatUsage?.(commandKind) ?? `Uso correto: ${commandKind} <termo da busca>`;
    const text = parseFailureMessage({ reason: parsed.reason, usage });
    const formatted = deps.stylizeReply ? deps.stylizeReply(text) : text;
    return [{ kind: "reply_text", text: formatted }];
  }

  return executeWebSearch({
    command: commandKind,
    query: parsed.query,
    search: deps.search,
    config: deps.config,
    stylizeReply: deps.stylizeReply,
    logger: deps.logger
  });
};
