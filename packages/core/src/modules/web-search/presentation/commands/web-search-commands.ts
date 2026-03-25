import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import { parseWebSearchCommand } from "../../infrastructure/web-search-command-parser.js";
import { executeWebSearch, type WebSearchUseCaseConfig } from "../../application/use-cases/search-web.js";
import type { WebSearchPort } from "../../ports.js";

export interface WebSearchCommandDeps {
  search?: WebSearchPort;
  config: WebSearchUseCaseConfig;
  formatUsage?: (command: "search" | "google") => string | null;
  stylizeReply?: (text: string) => string;
}

const handledCommands = new Set(["search", "google"]);

export const handleWebSearchCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: WebSearchCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, deps } = input;
  if (!handledCommands.has(commandKey)) return null;

  const parsed = parseWebSearchCommand(cmd);

  if (!parsed.ok) {
    const usage = deps.formatUsage?.(commandKey as "search" | "google") ?? "Uso correto: search <termo da busca>";
    const text = deps.stylizeReply ? deps.stylizeReply(usage) : usage;
    return [{ kind: "reply_text", text }];
  }

  return executeWebSearch({
    query: parsed.query,
    search: deps.search,
    config: deps.config,
    stylizeReply: deps.stylizeReply
  });
};
