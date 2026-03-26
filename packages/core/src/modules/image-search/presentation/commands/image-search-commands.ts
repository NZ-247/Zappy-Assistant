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

export const handleImageSearchCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: ImageSearchCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, deps } = input;
  if (!handledCommands.has(commandKey)) return null;
  const mode: ImageSearchExecutionMode = commandKey === "imglink" ? "media_or_links" : "media";

  const parsed = parseImageSearchCommand(cmd);

  if (!parsed.ok) {
    const usage = deps.formatUsage?.(commandKey as "img" | "gimage" | "imglink") ?? "Uso correto: img <termo da busca>";
    const text = deps.stylizeReply ? deps.stylizeReply(usage) : usage;
    return [{ kind: "reply_text", text }];
  }

  return executeImageSearch({
    query: parsed.query,
    imageSearch: deps.imageSearch,
    config: deps.config,
    mode,
    stylizeReply: deps.stylizeReply,
    logger: deps.logger
  });
};
