import type {
  DownloadExecutionResult,
  DownloadProbeResult,
  DownloadProviderDetection,
  DownloadProviderDownloadInput,
  DownloadProviderProbeInput,
  DownloadProviderResultKind,
  LoggerPort
} from "@zappy/core";
import {
  callResolverService,
  deriveStatusAndKind,
  estimateBase64Size,
  extractBase64Payload,
  isRecord,
  normalizeResultKind,
  pickNumber,
  pickObject,
  pickString,
  resolveAssetKindFromMime,
  type BridgeStatus
} from "./service-bridge-common.js";

type YoutubeContentKind = "watch" | "shorts" | "live" | "clip" | "unknown";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface YoutubePermalink {
  sourceUrl: string;
  normalizedUrl: string;
  kind: YoutubeContentKind;
  videoId?: string;
}

interface YoutubeNormalizedPayload {
  status: BridgeStatus;
  resultKind: DownloadProviderResultKind;
  reason?: string;
  title?: string;
  canonicalUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  assetKind?: "audio" | "video" | "image" | "document";
  fileName?: string;
  thumbnailUrl?: string;
  directUrl?: string;
  bufferBase64?: string;
}

export interface YoutubeServiceBridgeInput {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
  maxBytes: number;
  logger?: LoggerPort;
  fetchImpl?: FetchLike;
  metadataApiKey?: string;
}

export interface YoutubeServiceBridgeProvider {
  provider: {
    provider: "yt";
    detect: (input: { url: string }) => DownloadProviderDetection | null;
    probe: (input: DownloadProviderProbeInput) => Promise<DownloadProbeResult>;
    download: (input: DownloadProviderDownloadInput) => Promise<DownloadExecutionResult>;
    downloadWithProbe: (input: { probe: DownloadProbeResult; request: DownloadProviderDownloadInput }) => Promise<DownloadExecutionResult>;
  };
  checkHealth: () => Promise<boolean>;
}

const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const normalizeHost = (rawHost: string): string => rawHost.trim().toLowerCase().replace(/^www\./, "");

const isYoutubeHost = (rawHost: string): boolean => {
  const host = normalizeHost(rawHost);
  return host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtu.be";
};

const normalizeYoutubeId = (value?: string | null): string | undefined => {
  const candidate = (value ?? "").trim();
  if (!candidate) return undefined;
  if (!YOUTUBE_ID_REGEX.test(candidate)) return undefined;
  return candidate;
};

const parseYoutubePermalink = (rawUrl: string): YoutubePermalink | null => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (!isYoutubeHost(parsed.hostname)) return null;

  const host = normalizeHost(parsed.hostname);
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const firstPath = pathSegments[0]?.toLowerCase();

  let kind: YoutubeContentKind = "unknown";
  let videoId: string | undefined;

  if (host === "youtu.be") {
    videoId = normalizeYoutubeId(pathSegments[0]);
    kind = videoId ? "watch" : "unknown";
  } else if (firstPath === "watch" || parsed.pathname === "/watch") {
    videoId = normalizeYoutubeId(parsed.searchParams.get("v"));
    kind = videoId ? "watch" : "unknown";
  } else if (firstPath === "shorts") {
    videoId = normalizeYoutubeId(pathSegments[1]);
    kind = videoId ? "shorts" : "unknown";
  } else if (firstPath === "live") {
    videoId = normalizeYoutubeId(pathSegments[1]);
    kind = videoId ? "live" : "unknown";
  } else if (firstPath === "clip") {
    kind = "clip";
  }

  return {
    sourceUrl: rawUrl,
    normalizedUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : parsed.toString(),
    kind,
    videoId
  };
};

const detectionReasonFromKind = (kind: YoutubeContentKind): string => {
  if (kind === "watch") return "youtube_watch";
  if (kind === "shorts") return "youtube_shorts";
  if (kind === "live") return "youtube_live";
  if (kind === "clip") return "youtube_clip";
  return "youtube_unknown_path";
};

const detectionConfidenceFromKind = (kind: YoutubeContentKind): number => {
  if (kind === "unknown") return 0.7;
  if (kind === "clip") return 0.9;
  return 0.99;
};

const unwrapPayload = (input: unknown): Record<string, unknown> => {
  if (!isRecord(input)) return {};
  const rootCandidate = pickObject(input, ["result", "data", "payload"]);
  return rootCandidate ?? input;
};

const normalizeYoutubePayload = (input: {
  raw: unknown;
  permalink: YoutubePermalink;
  phase: "probe" | "download";
  logger?: LoggerPort;
}): YoutubeNormalizedPayload => {
  const payload = unwrapPayload(input.raw);
  const asset = pickObject(payload, ["asset", "media", "video", "file"]);

  const reason =
    pickString(payload, ["reason", "error", "message", "detail", "code"]) ??
    pickString(asset, ["reason", "error", "message"]);

  const explicitStatus = pickString(payload, ["status", "state", "resultStatus", "result_status"]);
  const explicitKind =
    pickString(payload, ["resultKind", "result_kind", "kind", "mediaKind", "media_kind", "type"]) ??
    pickString(asset, ["resultKind", "result_kind", "kind", "type"]);

  const inferredReadyKind: DownloadProviderResultKind =
    input.permalink.kind === "shorts" ? "reel_video" : "video_post";

  const { status, resultKind } = deriveStatusAndKind({
    explicitStatus,
    explicitKind,
    reason,
    defaultReadyKind: inferredReadyKind
  });

  const canonicalUrl =
    pickString(payload, ["canonicalUrl", "canonical_url", "permalink", "permalink_url", "pageUrl", "page_url"]) ??
    input.permalink.normalizedUrl;

  const title = pickString(payload, ["title", "videoTitle", "video_title", "name"]);
  const mimeType =
    pickString(asset, ["mimeType", "mime_type", "contentType", "content_type"]) ??
    pickString(payload, ["mimeType", "mime_type", "contentType", "content_type"]);

  const rawBase64 =
    pickString(asset, ["bufferBase64", "buffer_base64", "base64", "fileBase64", "file_base64", "data"]) ??
    pickString(payload, ["bufferBase64", "buffer_base64", "base64", "fileBase64", "file_base64", "data"]);
  const bufferBase64 = extractBase64Payload(rawBase64);

  const sizeFromPayload =
    pickNumber(asset, ["sizeBytes", "size_bytes", "contentLength", "content_length", "size"]) ??
    pickNumber(payload, ["sizeBytes", "size_bytes", "contentLength", "content_length", "size"]);

  const sizeBytes = sizeFromPayload ?? estimateBase64Size(bufferBase64);

  const directUrl =
    pickString(asset, ["directUrl", "direct_url", "downloadUrl", "download_url", "mediaUrl", "media_url", "url", "videoUrl", "video_url"]) ??
    pickString(payload, ["directUrl", "direct_url", "downloadUrl", "download_url", "mediaUrl", "media_url", "url", "videoUrl", "video_url"]);

  const thumbnailUrl =
    pickString(asset, ["thumbnailUrl", "thumbnail_url", "thumbnail", "thumb"]) ??
    pickString(payload, ["thumbnailUrl", "thumbnail_url", "thumbnail", "thumb"]);

  const fileName =
    pickString(asset, ["fileName", "file_name", "filename"]) ??
    pickString(payload, ["fileName", "file_name", "filename"]);

  const assetKind =
    resolveAssetKindFromMime(mimeType) ??
    (resultKind === "image_post" ? "image" : undefined) ??
    (resultKind === "video_post" || resultKind === "reel_video" ? "video" : undefined);

  input.logger?.info?.(
    {
      capability: "downloads",
      provider: "youtube-service",
      status: "provider_normalize_success",
      phase: input.phase,
      normalizedStatus: status,
      resultKind,
      hasDirectUrl: Boolean(directUrl),
      hasBufferBase64: Boolean(bufferBase64)
    },
    "youtube service payload normalized"
  );

  return {
    status,
    resultKind,
    reason,
    title,
    canonicalUrl,
    mimeType,
    sizeBytes,
    assetKind,
    fileName,
    thumbnailUrl,
    directUrl,
    bufferBase64
  };
};

const mapProbeToExecution = (probe: DownloadProbeResult): DownloadExecutionResult => ({
  provider: "yt",
  status: probe.status,
  resultKind: probe.resultKind,
  sourceUrl: probe.sourceUrl,
  canonicalUrl: probe.canonicalUrl,
  title: probe.title,
  reason: probe.reason,
  assets: []
});

const buildRequestBody = (input: {
  phase: "probe" | "download";
  request: DownloadProviderProbeInput | DownloadProviderDownloadInput;
  maxBytes: number;
  metadataApiKey?: string;
}): Record<string, unknown> => ({
  phase: input.phase,
  platform: "youtube",
  url: input.request.url,
  quality: "quality" in input.request ? input.request.quality : undefined,
  maxBytes: input.maxBytes,
  context: {
    tenantId: input.request.tenantId,
    waUserId: input.request.waUserId,
    waGroupId: input.request.waGroupId
  },
  metadata: {
    youtubeApiKey: input.metadataApiKey
  }
});

const toDownloadExecution = (input: {
  request: DownloadProviderDownloadInput;
  permalink: YoutubePermalink;
  normalized: YoutubeNormalizedPayload;
  maxBytes: number;
}): DownloadExecutionResult => {
  const effectiveMaxBytes = Math.max(1024, Math.trunc(input.maxBytes));

  if (input.normalized.status !== "ready") {
    return {
      provider: "yt",
      status: input.normalized.status,
      resultKind: input.normalized.resultKind,
      sourceUrl: input.permalink.sourceUrl,
      canonicalUrl: input.normalized.canonicalUrl,
      title: input.normalized.title,
      reason: input.normalized.reason,
      assets: []
    };
  }

  const sizeBytes = input.normalized.sizeBytes;
  if (sizeBytes && sizeBytes > effectiveMaxBytes) {
    return {
      provider: "yt",
      status: "blocked",
      resultKind: "blocked",
      sourceUrl: input.permalink.sourceUrl,
      canonicalUrl: input.normalized.canonicalUrl,
      title: input.normalized.title,
      reason: "max_bytes_exceeded",
      assets: []
    };
  }

  const base64Size = estimateBase64Size(input.normalized.bufferBase64);
  if (base64Size && base64Size > effectiveMaxBytes) {
    return {
      provider: "yt",
      status: "blocked",
      resultKind: "blocked",
      sourceUrl: input.permalink.sourceUrl,
      canonicalUrl: input.normalized.canonicalUrl,
      title: input.normalized.title,
      reason: "max_bytes_exceeded",
      assets: []
    };
  }

  if (!input.normalized.directUrl && !input.normalized.bufferBase64) {
    return {
      provider: "yt",
      status: "unsupported",
      resultKind: "preview_only",
      sourceUrl: input.permalink.sourceUrl,
      canonicalUrl: input.normalized.canonicalUrl,
      title: input.normalized.title,
      reason: "service_missing_asset",
      assets: []
    };
  }

  const assetKind = input.normalized.assetKind ?? (input.normalized.resultKind === "image_post" ? "image" : "video");
  const mimeType =
    input.normalized.mimeType ??
    (assetKind === "image" ? "image/jpeg" : assetKind === "audio" ? "audio/mpeg" : "video/mp4");

  return {
    provider: "yt",
    status: "ready",
    resultKind:
      input.normalized.resultKind === "unsupported"
        ? normalizeResultKind(input.normalized.reason) ?? (assetKind === "image" ? "image_post" : "video_post")
        : input.normalized.resultKind,
    sourceUrl: input.permalink.sourceUrl,
    canonicalUrl: input.normalized.canonicalUrl,
    title: input.normalized.title,
    reason: input.normalized.reason ?? "download_ready",
    assets: [
      {
        kind: assetKind,
        mimeType,
        fileName: input.normalized.fileName,
        sizeBytes: input.normalized.sizeBytes ?? base64Size,
        thumbnailUrl: input.normalized.thumbnailUrl,
        directUrl: input.normalized.directUrl,
        bufferBase64: input.normalized.bufferBase64
      }
    ]
  };
};

export const createYoutubeServiceBridgeProvider = (input: YoutubeServiceBridgeInput): YoutubeServiceBridgeProvider => {
  const providerName = "youtube-service";

  const resolveProbe = async (request: DownloadProviderProbeInput): Promise<DownloadProbeResult> => {
    const permalink = parseYoutubePermalink(request.url);
    if (!permalink) {
      return {
        provider: "yt",
        status: "invalid",
        resultKind: "unsupported",
        sourceUrl: request.url,
        reason: "invalid_youtube_url"
      };
    }

    const call = await callResolverService({
      provider: "yt",
      providerName,
      phase: "probe",
      baseUrl: input.baseUrl,
      token: input.token,
      timeoutMs: input.timeoutMs,
      logger: input.logger,
      fetchImpl: input.fetchImpl,
      body: buildRequestBody({
        phase: "probe",
        request,
        maxBytes: input.maxBytes,
        metadataApiKey: input.metadataApiKey
      })
    });

    if (!call.ok) {
      return {
        provider: "yt",
        status: "error",
        resultKind: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: permalink.normalizedUrl,
        reason: call.reason
      };
    }

    try {
      const normalized = normalizeYoutubePayload({
        raw: call.body,
        permalink,
        phase: "probe",
        logger: input.logger
      });

      return {
        provider: "yt",
        status: normalized.status,
        resultKind: normalized.resultKind,
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: normalized.canonicalUrl,
        title: normalized.title,
        reason: normalized.reason,
        metadata:
          normalized.mimeType || normalized.sizeBytes
            ? {
                mimeType: normalized.mimeType,
                sizeBytes: normalized.sizeBytes
              }
            : undefined
      };
    } catch (error) {
      input.logger?.warn?.(
        {
          capability: "downloads",
          provider: providerName,
          status: "provider_normalize_failed",
          phase: "probe",
          error
        },
        "youtube service payload normalization failed"
      );
      return {
        provider: "yt",
        status: "error",
        resultKind: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: permalink.normalizedUrl,
        reason: "normalize_failed"
      };
    }
  };

  const resolveDownload = async (request: DownloadProviderDownloadInput): Promise<DownloadExecutionResult> => {
    const permalink = parseYoutubePermalink(request.url);
    if (!permalink) {
      return {
        provider: "yt",
        status: "invalid",
        resultKind: "unsupported",
        sourceUrl: request.url,
        reason: "invalid_youtube_url",
        assets: []
      };
    }

    const effectiveMaxBytes = Math.max(1024, request.maxBytes ?? input.maxBytes);

    const call = await callResolverService({
      provider: "yt",
      providerName,
      phase: "download",
      baseUrl: input.baseUrl,
      token: input.token,
      timeoutMs: input.timeoutMs,
      logger: input.logger,
      fetchImpl: input.fetchImpl,
      body: buildRequestBody({
        phase: "download",
        request,
        maxBytes: effectiveMaxBytes,
        metadataApiKey: input.metadataApiKey
      })
    });

    if (!call.ok) {
      return {
        provider: "yt",
        status: "error",
        resultKind: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: permalink.normalizedUrl,
        reason: call.reason,
        assets: []
      };
    }

    try {
      const normalized = normalizeYoutubePayload({
        raw: call.body,
        permalink,
        phase: "download",
        logger: input.logger
      });
      return toDownloadExecution({
        request,
        permalink,
        normalized,
        maxBytes: effectiveMaxBytes
      });
    } catch (error) {
      input.logger?.warn?.(
        {
          capability: "downloads",
          provider: providerName,
          status: "provider_normalize_failed",
          phase: "download",
          error
        },
        "youtube service payload normalization failed"
      );
      return {
        provider: "yt",
        status: "error",
        resultKind: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: permalink.normalizedUrl,
        reason: "normalize_failed",
        assets: []
      };
    }
  };

  const checkHealth = async (): Promise<boolean> => {
    const call = await callResolverService({
      provider: "yt",
      providerName,
      phase: "health",
      method: "GET",
      baseUrl: input.baseUrl,
      token: input.token,
      timeoutMs: Math.min(input.timeoutMs, 6_000),
      logger: input.logger,
      fetchImpl: input.fetchImpl
    });

    if (!call.ok) return false;

    const payload = unwrapPayload(call.body);
    const explicitHealth =
      pickString(payload, ["status", "state"])?.toLowerCase() ??
      (pickObject(payload, ["health"]) ? "ok" : undefined);

    if (explicitHealth && ["ok", "healthy", "ready", "up"].includes(explicitHealth)) {
      return true;
    }

    return true;
  };

  return {
    provider: {
      provider: "yt",
      detect: (inputValue): DownloadProviderDetection | null => {
        const permalink = parseYoutubePermalink(inputValue.url);
        if (!permalink) return null;
        return {
          provider: "yt",
          family: "youtube",
          normalizedUrl: permalink.normalizedUrl,
          confidence: detectionConfidenceFromKind(permalink.kind),
          reason: detectionReasonFromKind(permalink.kind)
        };
      },
      probe: resolveProbe,
      downloadWithProbe: async (inputValue) => {
        if (inputValue.probe.status !== "ready") return mapProbeToExecution(inputValue.probe);
        return resolveDownload(inputValue.request);
      },
      download: resolveDownload
    },
    checkHealth
  };
};
