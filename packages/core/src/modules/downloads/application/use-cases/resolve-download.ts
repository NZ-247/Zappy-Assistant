import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { MediaDownloadPort, MediaDownloadProvider } from "../../ports.js";

export interface DownloadUseCaseConfig {
  enabled: boolean;
}

const sanitizeErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "erro desconhecido";
  const message = error.message.trim();
  if (!message) return "erro desconhecido";
  return message.length <= 140 ? message : `${message.slice(0, 137)}...`;
};

const formatBytes = (value?: number): string | null => {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let idx = 0;
  while (amount >= 1024 && idx < units.length - 1) {
    amount /= 1024;
    idx += 1;
  }
  return `${amount.toFixed(amount >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const statusToText = (status: string): string => {
  if (status === "ready") return "pronto";
  if (status === "unsupported") return "não suportado";
  if (status === "blocked") return "bloqueado";
  if (status === "invalid") return "inválido";
  return "erro";
};

export const resolveMediaDownload = async (input: {
  provider: MediaDownloadProvider;
  url: string;
  mediaDownload?: MediaDownloadPort;
  config: DownloadUseCaseConfig;
  tenantId?: string;
  waUserId?: string;
  waGroupId?: string;
  stylizeReply?: (text: string) => string;
}): Promise<ResponseAction[]> => {
  const replyText = (text: string): ResponseAction[] => [{ kind: "reply_text", text: input.stylizeReply ? input.stylizeReply(text) : text }];

  if (!input.config.enabled) {
    return replyText("Módulo de download está desativado neste ambiente.");
  }

  if (!input.mediaDownload) {
    return replyText("Módulo de download não está configurado no runtime atual.");
  }

  try {
    const result = await input.mediaDownload.resolve({
      provider: input.provider,
      url: input.url,
      tenantId: input.tenantId,
      waUserId: input.waUserId,
      waGroupId: input.waGroupId
    });

    const size = formatBytes(result.sizeBytes);
    const lines = [
      `Download provider: ${result.provider}`,
      `Status: ${statusToText(result.status)}`
    ];

    if (result.title) lines.push(`Título: ${result.title}`);
    if (result.mimeType) lines.push(`Tipo: ${result.mimeType}`);
    if (size) lines.push(`Tamanho: ${size}`);
    if (result.url) lines.push(`Link: ${result.url}`);
    if (result.reason) lines.push(`Detalhe: ${result.reason}`);

    return [{ kind: "reply_text", text: lines.join("\n") }];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return replyText(`Falha ao processar download: ${message}.`);
  }
};
