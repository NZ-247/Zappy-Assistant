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

type FacebookContentKind = "watch" | "video_path" | "reel" | "share" | "unknown";

interface FacebookPermalink {
  sourceUrl: string;
  normalizedUrl: string;
  kind: FacebookContentKind;
  videoId?: string;
}

interface FacebookNormalizedPayload {
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

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FacebookServiceBridgeInput {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
  maxBytes: number;
  logger?: LoggerPort;
  fetchImpl?: FetchLike;
  metadataAccessToken?: string;
  metadataGraphApiVersion?: string;
}

export interface FacebookServiceBridgeProvider {
  provider: {
    provider: "fb";
    detect: (input: { url: string }) => DownloadProviderDetection | null;
    probe: (input: DownloadProviderProbeInput) => Promise<DownloadProbeResult>;
    download: (input: DownloadProviderDownloadInput) => Promise<DownloadExecutionResult>;
    downloadWithProbe: (input: { probe: DownloadProbeResult; request: DownloadProviderDownloadInput }) => Promise<DownloadExecutionResult>;
  };
  checkHealth: () => Promise<boolean>;
}

const normalizeHost = (rawHost: string): string => rawHost.trim().toLowerCase().replace(/^www\./, "");

const isFacebookHost = (rawHost: string): boolean => {
  const host = normalizeHost(rawHost);
  return (
    host === "facebook.com" ||
    host === "m.facebook.com" ||
    host === "fb.watch" ||
    host === "facebook.watch" ||
    host === "l.facebook.com" ||
    host === "lm.facebook.com"
  );
};

const parseFacebookPermalink = (rawUrl: string): FacebookPermalink | null => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (!isFacebookHost(parsed.hostname)) return null;

  const host = normalizeHost(parsed.hostname);

  if ((host === "l.facebook.com" || host === "lm.facebook.com") && parsed.pathname.toLowerCase() === "/l.php") {
    const unwrapped = parsed.searchParams.get("u");
    if (!unwrapped) return null;
    const nested = parseFacebookPermalink(decodeURIComponent(unwrapped));
    if (!nested) return null;
    return {
      ...nested,
      sourceUrl: rawUrl
    };
  }

  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const lowerPath = parsed.pathname.toLowerCase();

  let kind: FacebookContentKind = "unknown";
  let videoId: string | undefined;
  let normalizedUrl = parsed.toString();

  if (host === "fb.watch") {
    videoId = pathSegments[0];
    if (videoId) {
      kind = "watch";
      normalizedUrl = `https://fb.watch/${videoId}/`;
    }
  } else if (lowerPath.startsWith("/watch")) {
    videoId = parsed.searchParams.get("v") ?? undefined;
    if (videoId) {
      kind = "watch";
      normalizedUrl = `https://www.facebook.com/watch/?v=${videoId}`;
    }
  } else if (pathSegments[0]?.toLowerCase() === "reel" && pathSegments[1]) {
    videoId = pathSegments[1];
    kind = "reel";
    normalizedUrl = `https://www.facebook.com/reel/${videoId}`;
  } else if (pathSegments[0]?.toLowerCase() === "share" && pathSegments[1]?.toLowerCase() === "v" && pathSegments[2]) {
    videoId = pathSegments[2];
    kind = "share";
    normalizedUrl = `https://www.facebook.com/watch/?v=${videoId}`;
  } else if (pathSegments[0]?.toLowerCase() === "share" && pathSegments[1]?.toLowerCase() === "r" && pathSegments[2]) {
    videoId = pathSegments[2];
    kind = "share";
    normalizedUrl = `https://www.facebook.com/reel/${videoId}`;
  } else if (pathSegments.includes("videos")) {
    const idx = pathSegments.findIndex((segment) => segment.toLowerCase() === "videos");
    videoId = pathSegments[idx + 1];
    kind = "video_path";
    normalizedUrl = `https://www.facebook.com${parsed.pathname}${parsed.search}`;
  } else if (lowerPath === "/share.php") {
    const shared = parsed.searchParams.get("u");
    if (shared) {
      const nested = parseFacebookPermalink(decodeURIComponent(shared));
      if (nested) {
        return {
          ...nested,
          sourceUrl: rawUrl
        };
      }
    }
  }

  return {
    sourceUrl: rawUrl,
    normalizedUrl,
    kind,
    videoId
  };
};

const detectionReasonFromKind = (kind: FacebookContentKind): string => {
  if (kind === "watch") return "facebook_watch";
  if (kind === "video_path") return "facebook_video";
  if (kind === "reel") return "facebook_reel";
  if (kind === "share") return "facebook_share";
  return "facebook_unknown_path";
};

const detectionConfidenceFromKind = (kind: FacebookContentKind): number => {
  if (kind === "unknown") return 0.72;
  return 0.98;
};

const unwrapPayload = (input: unknown): Record<string, unknown> => {
  if (!isRecord(input)) return {};
  const rootCandidate = pickObject(input, ["result", "data", "payload"]);
  return rootCandidate ?? input;
};

const normalizeFacebookPayload = (input: {
  raw: unknown;
  permalink: FacebookPermalink;
  phase: "probe" | "download";
  logger?: LoggerPort;
}): FacebookNormalizedPayload => {
  const payload = unwrapPayload(input.raw);
  const asset = pickObject(payload, ["asset", "media", "video", "file"]);

  const reason =
    pickString(payload, ["reason", "error", "message", "detail", "code"]) ??
    pickString(asset, ["reason", "error", "message"]);

  const explicitStatus = pickString(payload, ["status", "state", "resultStatus", "result_status"]);
  const explicitKind =
    pickString(payload, ["resultKind", "result_kind", "kind", "mediaKind", "media_kind", "type"]) ??
    pickString(asset, ["resultKind", "result_kind", "kind", "type"]);

  const inferredReadyKind: DownloadProviderResultKind = input.permalink.kind === "reel" ? "reel_video" : "video_post";

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
      provider: "facebook-service",
      status: "provider_normalize_success",
      phase: input.phase,
      normalizedStatus: status,
      resultKind,
      hasDirectUrl: Boolean(directUrl),
      hasBufferBase64: Boolean(bufferBase64)
    },
    "facebook service payload normalized"
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
  provider: "fb",
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
  metadataAccessToken?: string;
  metadataGraphApiVersion?: string;
}): Record<string, unknown> => ({
  phase: input.phase,
  platform: "facebook",
  url: input.request.url,
  quality: "quality" in input.request ? input.request.quality : undefined,
  maxBytes: input.maxBytes,
  context: {
    tenantId: input.request.tenantId,
    waUserId: input.request.waUserId,
    waGroupId: input.request.waGroupId
  },
  metadata: {
    facebookAccessToken: input.metadataAccessToken,
    graphApiVersion: input.metadataGraphApiVersion
  }
});

const toDownloadExecution = (input: {
  permalink: FacebookPermalink;
  normalized: FacebookNormalizedPayload;
  maxBytes: number;
}): DownloadExecutionResult => {
  const effectiveMaxBytes = Math.max(1024, Math.trunc(input.maxBytes));

  if (input.normalized.status !== "ready") {
    return {
      provider: "fb",
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
      provider: "fb",
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
      provider: "fb",
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
      provider: "fb",
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
    provider: "fb",
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

export const createFacebookServiceBridgeProvider = (input: FacebookServiceBridgeInput): FacebookServiceBridgeProvider => {
  const providerName = "facebook-service";

  const resolveProbe = async (request: DownloadProviderProbeInput): Promise<DownloadProbeResult> => {
    const permalink = parseFacebookPermalink(request.url);
    if (!permalink) {
      return {
        provider: "fb",
        status: "invalid",
        resultKind: "unsupported",
        sourceUrl: request.url,
        reason: "invalid_facebook_url"
      };
    }

    const call = await callResolverService({
      provider: "fb",
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
        metadataAccessToken: input.metadataAccessToken,
        metadataGraphApiVersion: input.metadataGraphApiVersion
      })
    });

    if (!call.ok) {
      return {
        provider: "fb",
        status: "error",
        resultKind: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: permalink.normalizedUrl,
        reason: call.reason
      };
    }

    try {
      const normalized = normalizeFacebookPayload({
        raw: call.body,
        permalink,
        phase: "probe",
        logger: input.logger
      });

      return {
        provider: "fb",
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
        "facebook service payload normalization failed"
      );
      return {
        provider: "fb",
        status: "error",
        resultKind: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: permalink.normalizedUrl,
        reason: "normalize_failed"
      };
    }
  };

  const resolveDownload = async (request: DownloadProviderDownloadInput): Promise<DownloadExecutionResult> => {
    const permalink = parseFacebookPermalink(request.url);
    if (!permalink) {
      return {
        provider: "fb",
        status: "invalid",
        resultKind: "unsupported",
        sourceUrl: request.url,
        reason: "invalid_facebook_url",
        assets: []
      };
    }

    const effectiveMaxBytes = Math.max(1024, request.maxBytes ?? input.maxBytes);

    const call = await callResolverService({
      provider: "fb",
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
        metadataAccessToken: input.metadataAccessToken,
        metadataGraphApiVersion: input.metadataGraphApiVersion
      })
    });

    if (!call.ok) {
      return {
        provider: "fb",
        status: "error",
        resultKind: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: permalink.normalizedUrl,
        reason: call.reason,
        assets: []
      };
    }

    try {
      const normalized = normalizeFacebookPayload({
        raw: call.body,
        permalink,
        phase: "download",
        logger: input.logger
      });
      return toDownloadExecution({
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
        "facebook service payload normalization failed"
      );
      return {
        provider: "fb",
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
      provider: "fb",
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
      provider: "fb",
      detect: (inputValue): DownloadProviderDetection | null => {
        const permalink = parseFacebookPermalink(inputValue.url);
        if (!permalink) return null;
        return {
          provider: "fb",
          family: "facebook",
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
