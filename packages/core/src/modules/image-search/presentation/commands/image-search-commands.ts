import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import { parseImageSearchCommand } from "../../infrastructure/image-search-command-parser.js";
import { executeImageSearch, type ImageSearchUseCaseConfig } from "../../application/use-cases/search-images.js";
import type { ImageSearchPort } from "../../ports.js";

export interface ImageSearchCommandDeps {
  imageSearch?: ImageSearchPort;
  config: ImageSearchUseCaseConfig;
  formatUsage?: (command: "img" | "gimage") => string | null;
  stylizeReply?: (text: string) => string;
}

const handledCommands = new Set(["img", "gimage"]);

export const handleImageSearchCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: ImageSearchCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, deps } = input;
  if (!handledCommands.has(commandKey)) return null;

  const parsed = parseImageSearchCommand(cmd);

  if (!parsed.ok) {
    const usage = deps.formatUsage?.(commandKey as "img" | "gimage") ?? "Uso correto: img <termo da busca>";
    const text = deps.stylizeReply ? deps.stylizeReply(usage) : usage;
    return [{ kind: "reply_text", text }];
  }

  return executeImageSearch({
    query: parsed.query,
    imageSearch: deps.imageSearch,
    config: deps.config,
    stylizeReply: deps.stylizeReply
  });
};
