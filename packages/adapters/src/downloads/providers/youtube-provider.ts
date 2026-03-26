import type {
  DownloadExecutionResult,
  DownloadProbeResult,
  DownloadProviderDetection,
  DownloadProviderDownloadInput,
  DownloadProviderProbeInput,
  LoggerPort
} from "@zappy/core";
import type { DownloadProviderAdapter } from "../types.js";

type YoutubeContentKind = "watch" | "shorts" | "live" | "clip" | "unknown";
type ComplianceMode = "blocked" | "prepare_only";

interface YoutubePermalink {
  sourceUrl: string;
  normalizedUrl: string;
  kind: YoutubeContentKind;
  videoId?: string;
}

interface YoutubeResolvedAssetCandidate {
  kind: "video";
  sourceUrl: string;
}

export interface YoutubeProviderInput {
  logger?: LoggerPort;
  complianceMode?: ComplianceMode;
  blockedReason?: string;
}

const DEFAULT_BLOCKED_REASON = "Provider YouTube permanece bloqueado por política de compliance/licenciamento.";
const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const normalizeHost = (rawHost: string): string => rawHost.trim().toLowerCase().replace(/^www\./, "");

const normalizeYoutubeId = (value?: string | null): string | undefined => {
  const candidate = (value ?? "").trim();
  if (!candidate) return undefined;
  if (!YOUTUBE_ID_REGEX.test(candidate)) return undefined;
  return candidate;
};

const isYoutubeHost = (rawHost: string): boolean => {
  const host = normalizeHost(rawHost);
  return host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtu.be";
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

  const normalizedUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : parsed.toString();
  return {
    sourceUrl: rawUrl,
    normalizedUrl,
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

const mapProbeToExecution = (probe: DownloadProbeResult): DownloadExecutionResult => ({
  provider: "yt",
  status: probe.status,
  sourceUrl: probe.sourceUrl,
  canonicalUrl: probe.canonicalUrl,
  title: probe.title,
  reason: probe.reason,
  assets: []
});

const logYoutubeInfo = (logger: LoggerPort | undefined, status: string, payload: Record<string, unknown>, message: string) => {
  logger?.info?.(
    {
      capability: "downloads",
      provider: "youtube",
      status,
      ...payload
    },
    message
  );
};

const logYoutubeWarn = (logger: LoggerPort | undefined, status: string, payload: Record<string, unknown>, message: string) => {
  logger?.warn?.(
    {
      capability: "downloads",
      provider: "youtube",
      status,
      ...payload
    },
    message
  );
};

const resolveYoutubeProbe = async (input: {
  request: DownloadProviderProbeInput;
  complianceMode: ComplianceMode;
  blockedReason: string;
  logger?: LoggerPort;
}): Promise<{ probe: DownloadProbeResult; permalink?: YoutubePermalink }> => {
  const permalink = parseYoutubePermalink(input.request.url);
  if (!permalink) {
    const probe: DownloadProbeResult = {
      provider: "yt",
      status: "invalid",
      sourceUrl: input.request.url,
      reason: "invalid_youtube_url"
    };
    logYoutubeInfo(input.logger, "youtube_probe_kind", {
      sourceUrl: input.request.url,
      probeStatus: probe.status,
      reason: probe.reason
    }, "youtube probe kind resolved");
    return { probe };
  }

  if (input.complianceMode === "blocked") {
    const probe: DownloadProbeResult = {
      provider: "yt",
      status: "blocked",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: input.blockedReason
    };
    logYoutubeInfo(input.logger, "youtube_probe_kind", {
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: probe.canonicalUrl,
      pathKind: permalink.kind,
      probeStatus: probe.status,
      reason: probe.reason
    }, "youtube probe kind resolved");
    return { probe, permalink };
  }

  if (permalink.kind === "unknown") {
    const probe: DownloadProbeResult = {
      provider: "yt",
      status: "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: "unsupported_youtube_path"
    };
    logYoutubeInfo(input.logger, "youtube_probe_kind", {
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: probe.canonicalUrl,
      pathKind: permalink.kind,
      probeStatus: probe.status,
      reason: probe.reason
    }, "youtube probe kind resolved");
    return { probe, permalink };
  }

  const probe: DownloadProbeResult = {
    provider: "yt",
    status: "ready",
    sourceUrl: permalink.sourceUrl,
    canonicalUrl: permalink.normalizedUrl,
    reason: "youtube_probe_ready",
    metadata: {
      mimeType: "video/mp4"
    }
  };
  logYoutubeInfo(input.logger, "youtube_probe_kind", {
    sourceUrl: permalink.sourceUrl,
    canonicalUrl: probe.canonicalUrl,
    pathKind: permalink.kind,
    probeStatus: probe.status,
    reason: probe.reason
  }, "youtube probe kind resolved");
  return { probe, permalink };
};

const resolveAsset = async (input: {
  probe: DownloadProbeResult;
  request: DownloadProviderDownloadInput;
  permalink?: YoutubePermalink;
  complianceMode: ComplianceMode;
  blockedReason: string;
  logger?: LoggerPort;
}): Promise<
  | { ok: true; asset: YoutubeResolvedAssetCandidate }
  | { ok: false; status: DownloadExecutionResult["status"]; reason: string }
> => {
  if (input.complianceMode === "blocked") {
    return {
      ok: false,
      status: "blocked",
      reason: input.blockedReason
    };
  }

  if (input.probe.status !== "ready") {
    return {
      ok: false,
      status: input.probe.status,
      reason: input.probe.reason ?? "probe_not_ready"
    };
  }

  if (!input.permalink) {
    return {
      ok: false,
      status: "invalid",
      reason: "invalid_youtube_url"
    };
  }

  logYoutubeInfo(input.logger, "youtube_asset_resolve_started", {
    sourceUrl: input.permalink.sourceUrl,
    canonicalUrl: input.permalink.normalizedUrl,
    pathKind: input.permalink.kind
  }, "youtube asset resolve started");

  logYoutubeWarn(input.logger, "youtube_asset_resolve_failed", {
    sourceUrl: input.permalink.sourceUrl,
    canonicalUrl: input.permalink.normalizedUrl,
    pathKind: input.permalink.kind,
    reason: "youtube_resolve_asset_not_implemented"
  }, "youtube asset resolve failed");

  return {
    ok: false,
    status: "unsupported",
    reason: "youtube_resolve_asset_not_implemented"
  };
};

const downloadResolvedAsset = async (input: {
  asset: YoutubeResolvedAssetCandidate;
  permalink: YoutubePermalink;
  logger?: LoggerPort;
}): Promise<
  | { ok: true; execution: DownloadExecutionResult }
  | { ok: false; status: DownloadExecutionResult["status"]; reason: string }
> => {
  logYoutubeWarn(input.logger, "youtube_download_failed", {
    sourceUrl: input.permalink.sourceUrl,
    canonicalUrl: input.permalink.normalizedUrl,
    assetKind: input.asset.kind,
    reason: "youtube_download_not_implemented"
  }, "youtube download failed");
  return {
    ok: false,
    status: "unsupported",
    reason: "youtube_download_not_implemented"
  };
};

const normalizeForWhatsApp = (input: {
  execution: DownloadExecutionResult;
  permalink: YoutubePermalink;
}): DownloadExecutionResult => ({
  ...input.execution,
  provider: "yt",
  sourceUrl: input.permalink.sourceUrl,
  canonicalUrl: input.execution.canonicalUrl ?? input.permalink.normalizedUrl
});

const executeDownloadFromProbe = async (input: {
  probe: DownloadProbeResult;
  request: DownloadProviderDownloadInput;
  permalink?: YoutubePermalink;
  complianceMode: ComplianceMode;
  blockedReason: string;
  logger?: LoggerPort;
}): Promise<DownloadExecutionResult> => {
  const resolvedAsset = await resolveAsset({
    probe: input.probe,
    request: input.request,
    permalink: input.permalink,
    complianceMode: input.complianceMode,
    blockedReason: input.blockedReason,
    logger: input.logger
  });
  if (!resolvedAsset.ok) {
    return {
      provider: "yt",
      status: resolvedAsset.status,
      sourceUrl: input.probe.sourceUrl,
      canonicalUrl: input.probe.canonicalUrl ?? input.permalink?.normalizedUrl,
      reason: resolvedAsset.reason,
      assets: []
    };
  }

  if (!input.permalink) {
    return {
      provider: "yt",
      status: "invalid",
      sourceUrl: input.probe.sourceUrl,
      canonicalUrl: input.probe.canonicalUrl,
      reason: "invalid_youtube_url",
      assets: []
    };
  }

  const downloaded = await downloadResolvedAsset({
    asset: resolvedAsset.asset,
    permalink: input.permalink,
    logger: input.logger
  });
  if (!downloaded.ok) {
    return {
      provider: "yt",
      status: downloaded.status,
      sourceUrl: input.permalink.sourceUrl,
      canonicalUrl: input.permalink.normalizedUrl,
      reason: downloaded.reason,
      assets: []
    };
  }

  return normalizeForWhatsApp({
    execution: downloaded.execution,
    permalink: input.permalink
  });
};

export const createYoutubeDownloadProvider = (input?: YoutubeProviderInput): DownloadProviderAdapter => {
  const logger = input?.logger;
  const complianceMode = input?.complianceMode ?? "blocked";
  const blockedReason = (input?.blockedReason ?? DEFAULT_BLOCKED_REASON).trim() || DEFAULT_BLOCKED_REASON;

  return {
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
    probe: async (request) => {
      const resolved = await resolveYoutubeProbe({
        request,
        complianceMode,
        blockedReason,
        logger
      });
      return resolved.probe;
    },
    downloadWithProbe: async (inputValue) => {
      if (inputValue.probe.status !== "ready") return mapProbeToExecution(inputValue.probe);
      const permalink = parseYoutubePermalink(inputValue.probe.canonicalUrl ?? inputValue.request.url) ?? parseYoutubePermalink(inputValue.request.url) ?? undefined;
      return executeDownloadFromProbe({
        probe: inputValue.probe,
        request: inputValue.request,
        permalink,
        complianceMode,
        blockedReason,
        logger
      });
    },
    download: async (request: DownloadProviderDownloadInput): Promise<DownloadExecutionResult> => {
      const resolved = await resolveYoutubeProbe({
        request,
        complianceMode,
        blockedReason,
        logger
      });
      if (resolved.probe.status !== "ready") return mapProbeToExecution(resolved.probe);
      return executeDownloadFromProbe({
        probe: resolved.probe,
        request,
        permalink: resolved.permalink,
        complianceMode,
        blockedReason,
        logger
      });
    }
  };
};
