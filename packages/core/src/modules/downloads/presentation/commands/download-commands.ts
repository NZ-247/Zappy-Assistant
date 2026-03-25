import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import { parseDownloadCommand } from "../../infrastructure/download-command-parser.js";
import { resolveMediaDownload, type DownloadUseCaseConfig } from "../../application/use-cases/resolve-download.js";
import type { MediaDownloadPort } from "../../ports.js";

export interface DownloadCommandDeps {
  mediaDownload?: MediaDownloadPort;
  config: DownloadUseCaseConfig;
  formatUsage?: (command: "dl") => string | null;
  stylizeReply?: (text: string) => string;
}

const parseErrorMessage = (reason: string, usage?: string | null): string => {
  if (usage) return usage;
  if (reason === "missing_provider") return "Uso correto: dl <yt|ig|fb|direct> <link>";
  if (reason === "invalid_provider") return "Provider inválido. Use: yt, ig, fb ou direct.";
  if (reason === "missing_url") return "Informe um link para processar. Exemplo: dl direct https://...";
  return "Link inválido. Use URL http(s) válida.";
};

export const handleDownloadCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: DownloadCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps } = input;
  if (commandKey !== "dl") return null;

  const parsed = parseDownloadCommand(cmd);
  if (!parsed.ok) {
    const usage = deps.formatUsage?.("dl");
    const text = parseErrorMessage(parsed.reason, usage);
    return [{ kind: "reply_text", text: deps.stylizeReply ? deps.stylizeReply(text) : text }];
  }

  return resolveMediaDownload({
    provider: parsed.provider,
    url: parsed.url,
    mediaDownload: deps.mediaDownload,
    config: deps.config,
    tenantId: ctx.event.tenantId,
    waUserId: ctx.event.waUserId,
    waGroupId: ctx.event.waGroupId,
    stylizeReply: deps.stylizeReply
  });
};
