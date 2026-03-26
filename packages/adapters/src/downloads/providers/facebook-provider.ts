import type {
  DownloadExecutionResult,
  DownloadProbeResult,
  DownloadProviderDetection,
  DownloadProviderDownloadInput,
  DownloadProviderProbeInput,
  LoggerPort
} from "@zappy/core";
import type { DownloadProviderAdapter } from "../types.js";

type FacebookContentKind = "watch" | "video_path" | "reel" | "unknown";
type ComplianceMode = "blocked" | "prepare_only";

interface FacebookPermalink {
  sourceUrl: string;
  normalizedUrl: string;
  kind: FacebookContentKind;
  videoId?: string;
}

interface FacebookResolvedAssetCandidate {
  kind: "video";
  sourceUrl: string;
}

export interface FacebookProviderInput {
  logger?: LoggerPort;
  complianceMode?: ComplianceMode;
  blockedReason?: string;
}

const DEFAULT_BLOCKED_REASON = "Provider Facebook permanece bloqueado por política de compliance/licenciamento.";

const normalizeHost = (rawHost: string): string => rawHost.trim().toLowerCase().replace(/^www\./, "");

const isFacebookHost = (rawHost: string): boolean => {
  const host = normalizeHost(rawHost);
  return host === "facebook.com" || host === "m.facebook.com" || host === "fb.watch" || host === "facebook.watch";
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
    } else {
      kind = "video_path";
      normalizedUrl = `https://www.facebook.com${parsed.pathname}${parsed.search}`;
    }
  } else if (pathSegments.includes("videos")) {
    const idx = pathSegments.findIndex((segment) => segment.toLowerCase() === "videos");
    videoId = pathSegments[idx + 1];
    kind = "video_path";
    normalizedUrl = `https://www.facebook.com${parsed.pathname}${parsed.search}`;
  } else if (pathSegments[0]?.toLowerCase() === "reel") {
    videoId = pathSegments[1];
    kind = "reel";
    normalizedUrl = `https://www.facebook.com/reel/${videoId ?? ""}`.replace(/\/$/, "");
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
  return "facebook_unknown_path";
};

const detectionConfidenceFromKind = (kind: FacebookContentKind): number => {
  if (kind === "unknown") return 0.72;
  return 0.98;
};

const mapProbeToExecution = (probe: DownloadProbeResult): DownloadExecutionResult => ({
  provider: "fb",
  status: probe.status,
  sourceUrl: probe.sourceUrl,
  canonicalUrl: probe.canonicalUrl,
  title: probe.title,
  reason: probe.reason,
  assets: []
});

const logFacebookInfo = (logger: LoggerPort | undefined, status: string, payload: Record<string, unknown>, message: string) => {
  logger?.info?.(
    {
      capability: "downloads",
      provider: "facebook",
      status,
      ...payload
    },
    message
  );
};

const logFacebookWarn = (logger: LoggerPort | undefined, status: string, payload: Record<string, unknown>, message: string) => {
  logger?.warn?.(
    {
      capability: "downloads",
      provider: "facebook",
      status,
      ...payload
    },
    message
  );
};

const resolveFacebookProbe = async (input: {
  request: DownloadProviderProbeInput;
  complianceMode: ComplianceMode;
  blockedReason: string;
  logger?: LoggerPort;
}): Promise<{ probe: DownloadProbeResult; permalink?: FacebookPermalink }> => {
  const permalink = parseFacebookPermalink(input.request.url);
  if (!permalink) {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "invalid",
      sourceUrl: input.request.url,
      reason: "invalid_facebook_url"
    };
    logFacebookInfo(input.logger, "facebook_probe_kind", {
      sourceUrl: input.request.url,
      probeStatus: probe.status,
      reason: probe.reason
    }, "facebook probe kind resolved");
    return { probe };
  }

  if (input.complianceMode === "blocked") {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "blocked",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: input.blockedReason
    };
    logFacebookInfo(input.logger, "facebook_probe_kind", {
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: probe.canonicalUrl,
      pathKind: permalink.kind,
      probeStatus: probe.status,
      reason: probe.reason
    }, "facebook probe kind resolved");
    return { probe, permalink };
  }

  if (permalink.kind === "unknown") {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: "unsupported_facebook_path"
    };
    logFacebookInfo(input.logger, "facebook_probe_kind", {
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: probe.canonicalUrl,
      pathKind: permalink.kind,
      probeStatus: probe.status,
      reason: probe.reason
    }, "facebook probe kind resolved");
    return { probe, permalink };
  }

  const probe: DownloadProbeResult = {
    provider: "fb",
    status: "ready",
    sourceUrl: permalink.sourceUrl,
    canonicalUrl: permalink.normalizedUrl,
    reason: "facebook_probe_ready",
    metadata: {
      mimeType: "video/mp4"
    }
  };
  logFacebookInfo(input.logger, "facebook_probe_kind", {
    sourceUrl: permalink.sourceUrl,
    canonicalUrl: probe.canonicalUrl,
    pathKind: permalink.kind,
    probeStatus: probe.status,
    reason: probe.reason
  }, "facebook probe kind resolved");
  return { probe, permalink };
};

const resolveAsset = async (input: {
  probe: DownloadProbeResult;
  request: DownloadProviderDownloadInput;
  permalink?: FacebookPermalink;
  complianceMode: ComplianceMode;
  blockedReason: string;
  logger?: LoggerPort;
}): Promise<
  | { ok: true; asset: FacebookResolvedAssetCandidate }
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
      reason: "invalid_facebook_url"
    };
  }

  logFacebookInfo(input.logger, "facebook_asset_resolve_started", {
    sourceUrl: input.permalink.sourceUrl,
    canonicalUrl: input.permalink.normalizedUrl,
    pathKind: input.permalink.kind
  }, "facebook asset resolve started");

  logFacebookWarn(input.logger, "facebook_asset_resolve_failed", {
    sourceUrl: input.permalink.sourceUrl,
    canonicalUrl: input.permalink.normalizedUrl,
    pathKind: input.permalink.kind,
    reason: "facebook_resolve_asset_not_implemented"
  }, "facebook asset resolve failed");

  return {
    ok: false,
    status: "unsupported",
    reason: "facebook_resolve_asset_not_implemented"
  };
};

const downloadResolvedAsset = async (input: {
  asset: FacebookResolvedAssetCandidate;
  permalink: FacebookPermalink;
  logger?: LoggerPort;
}): Promise<
  | { ok: true; execution: DownloadExecutionResult }
  | { ok: false; status: DownloadExecutionResult["status"]; reason: string }
> => {
  logFacebookWarn(input.logger, "facebook_download_failed", {
    sourceUrl: input.permalink.sourceUrl,
    canonicalUrl: input.permalink.normalizedUrl,
    assetKind: input.asset.kind,
    reason: "facebook_download_not_implemented"
  }, "facebook download failed");
  return {
    ok: false,
    status: "unsupported",
    reason: "facebook_download_not_implemented"
  };
};

const normalizeForWhatsApp = (input: {
  execution: DownloadExecutionResult;
  permalink: FacebookPermalink;
}): DownloadExecutionResult => ({
  ...input.execution,
  provider: "fb",
  sourceUrl: input.permalink.sourceUrl,
  canonicalUrl: input.execution.canonicalUrl ?? input.permalink.normalizedUrl
});

const executeDownloadFromProbe = async (input: {
  probe: DownloadProbeResult;
  request: DownloadProviderDownloadInput;
  permalink?: FacebookPermalink;
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
      provider: "fb",
      status: resolvedAsset.status,
      sourceUrl: input.probe.sourceUrl,
      canonicalUrl: input.probe.canonicalUrl ?? input.permalink?.normalizedUrl,
      reason: resolvedAsset.reason,
      assets: []
    };
  }

  if (!input.permalink) {
    return {
      provider: "fb",
      status: "invalid",
      sourceUrl: input.probe.sourceUrl,
      canonicalUrl: input.probe.canonicalUrl,
      reason: "invalid_facebook_url",
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
      provider: "fb",
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

export const createFacebookDownloadProvider = (input?: FacebookProviderInput): DownloadProviderAdapter => {
  const logger = input?.logger;
  const complianceMode = input?.complianceMode ?? "blocked";
  const blockedReason = (input?.blockedReason ?? DEFAULT_BLOCKED_REASON).trim() || DEFAULT_BLOCKED_REASON;

  return {
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
    probe: async (request) => {
      const resolved = await resolveFacebookProbe({
        request,
        complianceMode,
        blockedReason,
        logger
      });
      return resolved.probe;
    },
    downloadWithProbe: async (inputValue) => {
      if (inputValue.probe.status !== "ready") return mapProbeToExecution(inputValue.probe);
      const permalink = parseFacebookPermalink(inputValue.probe.canonicalUrl ?? inputValue.request.url) ?? parseFacebookPermalink(inputValue.request.url) ?? undefined;
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
      const resolved = await resolveFacebookProbe({
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
