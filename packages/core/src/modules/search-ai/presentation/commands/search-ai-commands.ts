import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import { parseSearchAiCommand } from "../../infrastructure/search-ai-command-parser.js";
import { executeSearchAi, type SearchAiUseCaseConfig } from "../../application/use-cases/search-ai.js";
import type { SearchAiPort } from "../../ports.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";

export interface SearchAiCommandDeps {
  searchAi?: SearchAiPort;
  config: SearchAiUseCaseConfig;
  formatUsage?: (command: "search-ai") => string | null;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}

const handledCommands = new Set(["search-ai", "sai"]);

const parseFailureMessage = (input: {
  reason: "missing_query" | "incompatible_reply";
  usage: string;
}): string => {
  if (input.reason === "incompatible_reply") {
    return `Esse comando usa texto. Responda uma mensagem de texto ou informe o termo.\n${input.usage}`;
  }
  return input.usage;
};

export const handleSearchAiCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: SearchAiCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps } = input;
  if (!handledCommands.has(commandKey)) return null;

  const parsed = parseSearchAiCommand(cmd, {
    replyContext: {
      quotedWaMessageId: ctx.event.quotedWaMessageId,
      quotedMessageType: ctx.event.quotedMessageType,
      quotedText: ctx.event.quotedText,
      quotedHasMedia: ctx.event.quotedHasMedia
    }
  });

  if (!parsed.ok) {
    const usage = deps.formatUsage?.("search-ai") ?? "Uso correto: search-ai <termo da busca>";
    const text = parseFailureMessage({ reason: parsed.reason, usage });
    const formatted = deps.stylizeReply ? deps.stylizeReply(text) : text;
    return [{ kind: "reply_text", text: formatted }];
  }

  return executeSearchAi({
    query: parsed.query,
    searchAi: deps.searchAi,
    config: deps.config,
    stylizeReply: deps.stylizeReply,
    logger: deps.logger
  });
};
