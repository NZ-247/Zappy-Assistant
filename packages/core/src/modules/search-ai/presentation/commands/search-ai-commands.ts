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

export const handleSearchAiCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: SearchAiCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, deps } = input;
  if (!handledCommands.has(commandKey)) return null;

  const parsed = parseSearchAiCommand(cmd);

  if (!parsed.ok) {
    const usage = deps.formatUsage?.("search-ai") ?? "Uso correto: search-ai <termo da busca>";
    const text = deps.stylizeReply ? deps.stylizeReply(usage) : usage;
    return [{ kind: "reply_text", text }];
  }

  return executeSearchAi({
    query: parsed.query,
    searchAi: deps.searchAi,
    config: deps.config,
    stylizeReply: deps.stylizeReply,
    logger: deps.logger
  });
};
