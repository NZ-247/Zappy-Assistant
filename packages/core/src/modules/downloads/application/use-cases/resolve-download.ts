import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { MediaDownloadPort, MediaDownloadProvider } from "../../ports.js";

export interface DownloadUseCaseConfig {
  enabled: boolean;
  maxBytes?: number;
}

const trimCaption = (value?: string): string | undefined => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 93)}...`;
};

const statusMessage = (status: string, reason?: string): string => {
  const detail = (reason ?? "").trim();
  if (detail === "preview_only") {
    return "Esse link só mostra prévia pública; não encontrei vídeo para baixar.";
  }
  if (status === "unsupported") {
    return "Esse link ainda não é suportado pelo /dl.";
  }
  if (status === "blocked") {
    return "Esse link está privado, bloqueado ou requer login.";
  }
  if (status === "invalid") {
    return "Não consegui validar esse link. Verifique se ele é público.";
  }
  if (detail) {
    return "Não consegui baixar esse link agora. Tente novamente em instantes.";
  }
  return "Falha ao processar o download agora.";
};

const resolveAssetUrl = (input: {
  directUrl?: string;
  resultUrl?: string;
  fallbackUrl: string;
}): string => {
  const preferred = (input.directUrl ?? input.resultUrl ?? "").trim();
  if (preferred) return preferred;
  return input.fallbackUrl;
};

export const resolveMediaDownload = async (input: {
  provider?: MediaDownloadProvider;
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
      waGroupId: input.waGroupId,
      maxBytes: input.config.maxBytes
    });

    if (result.status !== "ready") {
      return replyText(statusMessage(result.status, result.reason));
    }

    const asset = result.asset;
    if (!asset) {
      if (result.url) {
        return replyText(`Download pronto: ${result.url}`);
      }
      return replyText("Consegui processar o link, mas não encontrei mídia para enviar.");
    }

    const caption = trimCaption(result.title) ?? `via /dl ${result.provider}`;

    if (asset.kind === "image") {
      return [
        {
          kind: "reply_image",
          imageUrl: resolveAssetUrl({
            directUrl: asset.directUrl,
            resultUrl: result.url,
            fallbackUrl: input.url
          }),
          imageBase64: asset.bufferBase64,
          mimeType: asset.mimeType,
          caption
        }
      ];
    }

    if (asset.kind === "video") {
      return [
        {
          kind: "reply_video",
          videoUrl: resolveAssetUrl({
            directUrl: asset.directUrl,
            resultUrl: result.url,
            fallbackUrl: input.url
          }),
          videoBase64: asset.bufferBase64,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          caption
        }
      ];
    }

    if (asset.kind === "audio" && asset.bufferBase64) {
      return [
        {
          kind: "reply_audio",
          audioBase64: asset.bufferBase64,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          caption
        }
      ];
    }

    if (result.url) {
      return replyText(`Download pronto: ${result.url}`);
    }

    return replyText("Consegui processar o link, mas esse formato ainda não está pronto para envio direto.");
  } catch {
    return replyText("Não consegui processar esse link agora. Tente novamente em instantes.");
  }
};
