import type { MediaDownloadProviderAdapter } from "../types.js";

export interface DirectDownloadProviderInput {
  timeoutMs?: number;
}

const MEDIA_MIME_PREFIXES = ["audio/", "video/", "image/"];
const MEDIA_MIME_EXACT = new Set(["application/pdf", "application/octet-stream"]);

const withTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
};

const isMediaMimeType = (mimeType: string): boolean => {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) return false;
  if (MEDIA_MIME_EXACT.has(normalized)) return true;
  return MEDIA_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const resolveByMethod = async (url: string, method: "HEAD" | "GET", timeoutMs: number): Promise<Response> => {
  const signal = withTimeoutSignal(timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: signal.signal
    });
  } finally {
    signal.clear();
  }
};

export const createDirectDownloadProvider = (input?: DirectDownloadProviderInput): MediaDownloadProviderAdapter => {
  const timeoutMs = input?.timeoutMs ?? 12_000;

  return {
    provider: "direct",
    resolve: async ({ url }) => {
      let response: Response;
      try {
        response = await resolveByMethod(url, "HEAD", timeoutMs);
        if (!response.ok || response.status === 405) {
          response = await resolveByMethod(url, "GET", timeoutMs);
        }
      } catch (error) {
        return {
          provider: "direct",
          status: "error",
          url,
          reason: error instanceof Error ? error.message : "network_error"
        };
      }

      if (!response.ok) {
        return {
          provider: "direct",
          status: "invalid",
          url,
          reason: `Resposta HTTP ${response.status}`
        };
      }

      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
      const contentLengthHeader = response.headers.get("content-length");
      const sizeBytes = contentLengthHeader ? Number(contentLengthHeader) : undefined;

      if (!isMediaMimeType(contentType)) {
        return {
          provider: "direct",
          status: "unsupported",
          url: response.url || url,
          mimeType: contentType || undefined,
          reason: "Link direto não aponta para mídia suportada."
        };
      }

      return {
        provider: "direct",
        status: "ready",
        url: response.url || url,
        mimeType: contentType || undefined,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined,
        reason: "Link validado para processamento direto."
      };
    }
  };
};
