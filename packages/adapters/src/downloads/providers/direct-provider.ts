import type {
  DownloadExecutionResult,
  DownloadProviderDetection,
  DownloadProviderDownloadInput,
  DownloadProviderProbeInput,
  DownloadProbeResult
} from "@zappy/core";
import type { DownloadProviderAdapter } from "../types.js";

export interface DirectDownloadProviderInput {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
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

const normalizeMimeType = (value?: string | null): string => (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

const isMediaMimeType = (mimeType: string): boolean => {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return false;
  if (MEDIA_MIME_EXACT.has(normalized)) return true;
  return MEDIA_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const resolveAssetKind = (mimeType: string): "audio" | "video" | "image" | "document" => {
  const normalized = normalizeMimeType(mimeType);
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("image/")) return "image";
  return "document";
};

const resultKindFromAssetKind = (kind: "audio" | "video" | "image" | "document"): "image_post" | "video_post" | "unsupported" => {
  if (kind === "image") return "image_post";
  if (kind === "video") return "video_post";
  return "unsupported";
};

const parseHttpUrl = (value: string): URL | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
};

const resolveByMethod = async (input: {
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;
  url: string;
  method: "HEAD" | "GET";
  timeoutMs: number;
}): Promise<Response> => {
  const timeout = withTimeoutSignal(input.timeoutMs);
  try {
    return await input.fetchImpl(input.url, {
      method: input.method,
      redirect: "follow",
      signal: timeout.signal,
      headers: {
        "User-Agent": "zappy-assistant/1.6 (downloads-direct)",
        Accept: "*/*"
      }
    });
  } finally {
    timeout.clear();
  }
};

const resolveProbe = async (input: {
  request: DownloadProviderProbeInput;
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs: number;
}): Promise<DownloadProbeResult> => {
  const parsed = parseHttpUrl(input.request.url);
  if (!parsed) {
    return {
      provider: "direct",
      status: "invalid",
      resultKind: "unsupported",
      sourceUrl: input.request.url,
      reason: "invalid_url"
    };
  }

  let response: Response;
  try {
    response = await resolveByMethod({
      fetchImpl: input.fetchImpl,
      url: parsed.toString(),
      method: "HEAD",
      timeoutMs: input.timeoutMs
    });
    if (!response.ok || response.status === 405) {
      response = await resolveByMethod({
        fetchImpl: input.fetchImpl,
        url: parsed.toString(),
        method: "GET",
        timeoutMs: input.timeoutMs
      });
    }
  } catch (error) {
    return {
      provider: "direct",
      status: "error",
      resultKind: "unsupported",
      sourceUrl: parsed.toString(),
      reason: error instanceof Error ? error.message : "network_error"
    };
  }

  if (!response.ok) {
    return {
      provider: "direct",
      status: "invalid",
      resultKind: "unsupported",
      sourceUrl: parsed.toString(),
      canonicalUrl: response.url || parsed.toString(),
      reason: `http_${response.status}`
    };
  }

  const mimeType = normalizeMimeType(response.headers.get("content-type"));
  if (!isMediaMimeType(mimeType)) {
    return {
      provider: "direct",
      status: "unsupported",
      resultKind: "unsupported",
      sourceUrl: parsed.toString(),
      canonicalUrl: response.url || parsed.toString(),
      reason: "unsupported_content_type",
      metadata: {
        mimeType: mimeType || undefined
      }
    };
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  const sizeBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined;

  return {
    provider: "direct",
    status: "ready",
    resultKind: resultKindFromAssetKind(resolveAssetKind(mimeType)),
    sourceUrl: parsed.toString(),
    canonicalUrl: response.url || parsed.toString(),
    metadata: {
      mimeType,
      sizeBytes
    },
    reason: "direct_media_ready"
  };
};

export const createDirectDownloadProvider = (input?: DirectDownloadProviderInput): DownloadProviderAdapter => {
  const timeoutMs = input?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = input?.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = input?.fetchImpl ?? fetch;

  return {
    provider: "direct",
    detect: (request): DownloadProviderDetection | null => {
      const parsed = parseHttpUrl(request.url);
      if (!parsed) return null;
      return {
        provider: "direct",
        family: "direct",
        normalizedUrl: parsed.toString(),
        confidence: 0.25,
        reason: "generic_http_url"
      };
    },
    probe: async (request) =>
      resolveProbe({
        request,
        fetchImpl,
        timeoutMs
      }),
    download: async (request: DownloadProviderDownloadInput): Promise<DownloadExecutionResult> => {
      const probe = await resolveProbe({
        request,
        fetchImpl,
        timeoutMs
      });

      if (probe.status !== "ready") {
        return {
          provider: "direct",
          status: probe.status,
          resultKind: probe.resultKind,
          sourceUrl: probe.sourceUrl,
          canonicalUrl: probe.canonicalUrl,
          title: probe.title,
          reason: probe.reason,
          assets: []
        };
      }

      const assetMimeType = probe.metadata?.mimeType ?? "";
      const assetSize = probe.metadata?.sizeBytes;
      const effectiveMaxBytes = request.maxBytes ?? maxBytes;
      if (assetSize && assetSize > effectiveMaxBytes) {
        return {
          provider: "direct",
          status: "blocked",
          resultKind: "blocked",
          sourceUrl: probe.sourceUrl,
          canonicalUrl: probe.canonicalUrl,
          reason: "max_bytes_exceeded",
          assets: []
        };
      }

      return {
        provider: "direct",
        status: "ready",
        resultKind: resultKindFromAssetKind(resolveAssetKind(assetMimeType)),
        sourceUrl: probe.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        title: probe.title,
        reason: probe.reason,
        assets: [
          {
            kind: resolveAssetKind(assetMimeType),
            mimeType: assetMimeType || "application/octet-stream",
            sizeBytes: assetSize,
            directUrl: probe.canonicalUrl ?? probe.sourceUrl
          }
        ]
      };
    }
  };
};
