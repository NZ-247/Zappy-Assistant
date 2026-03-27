import type {
  DownloadExecutionResult,
  DownloadProbeResult,
  DownloadProviderDetection,
  DownloadProviderDownloadInput,
  DownloadProviderProbeInput,
  DownloadProviderResultKind,
  LoggerPort
} from "@zappy/core";
import type { DownloadProviderAdapter } from "../types.js";

type YoutubeContentKind = "watch" | "shorts" | "live" | "clip" | "unknown";
type ComplianceMode = "blocked" | "prepare_only";
type YoutubeProbeKind = "video_post" | "reel_video";

type MetadataOutcome =
  | {
      status: "ok";
      title?: string;
      thumbnailUrl?: string;
      canonicalUrl?: string;
    }
  | {
      status: "private" | "login_required" | "invalid" | "error";
      reason: string;
    };

interface YoutubePermalink {
  sourceUrl: string;
  normalizedUrl: string;
  kind: YoutubeContentKind;
  videoId?: string;
}

interface YoutubeResolvedPage {
  sourceUrl: string;
  canonicalUrl: string;
  kind: YoutubeContentKind;
  probeKind: YoutubeProbeKind;
  videoId: string;
  title?: string;
  thumbnailUrl?: string;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface YoutubeProviderInput {
  logger?: LoggerPort;
  complianceMode?: ComplianceMode;
  blockedReason?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  apiKey?: string;
}

const DEFAULT_BLOCKED_REASON = "Provider YouTube permanece bloqueado por politica de compliance/licenciamento.";
const DEFAULT_TIMEOUT_MS = 12_000;
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
  resultKind: probe.resultKind,
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

const withTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
};

const normalizeYoutubeResultKind = (input: {
  status: DownloadExecutionResult["status"];
  reason?: string;
  probeKind?: YoutubeProbeKind;
}): DownloadProviderResultKind => {
  const reason = (input.reason ?? "").toLowerCase();
  if (reason.includes("preview_only")) return "preview_only";
  if (reason.includes("private")) return "private";
  if (reason.includes("login")) return "login_required";
  if (input.status === "blocked") return "blocked";
  if (input.probeKind === "reel_video") return "reel_video";
  if (input.probeKind === "video_post") return "video_post";
  return "unsupported";
};

const parseJsonSafely = async <T>(response: Response): Promise<T | null> => {
  try {
    const raw = await response.text();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const fetchYoutubeMetadataFromDataApi = async (input: {
  apiKey: string;
  videoId: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<MetadataOutcome | null> => {
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "snippet,status");
  endpoint.searchParams.set("id", input.videoId);
  endpoint.searchParams.set("key", input.apiKey);

  const timeout = withTimeoutSignal(input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetchImpl(endpoint.toString(), {
      method: "GET",
      signal: timeout.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "zappy-assistant/1.8 (downloads-youtube-metadata)"
      }
    });
  } catch (error) {
    timeout.clear();
    return {
      status: "error",
      reason: error instanceof Error && error.name === "AbortError" ? "metadata_timeout" : "metadata_network_error"
    };
  } finally {
    timeout.clear();
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: "login_required",
      reason: `youtube_data_api_http_${response.status}`
    };
  }

  if (response.status === 404) {
    return {
      status: "invalid",
      reason: "youtube_video_not_found"
    };
  }

  if (!response.ok) {
    return {
      status: "error",
      reason: `youtube_data_api_http_${response.status}`
    };
  }

  const parsed = await parseJsonSafely<{
    items?: Array<{
      snippet?: {
        title?: string;
        thumbnails?: Record<string, { url?: string }>;
      };
      status?: {
        privacyStatus?: string;
      };
    }>;
  }>(response);

  const item = parsed?.items?.[0];
  if (!item) {
    return {
      status: "invalid",
      reason: "youtube_video_not_found"
    };
  }

  const privacyStatus = String(item.status?.privacyStatus ?? "").toLowerCase();
  if (privacyStatus === "private") {
    return {
      status: "private",
      reason: "private"
    };
  }

  const thumbnails = item.snippet?.thumbnails;
  const thumbnailUrl =
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url;

  return {
    status: "ok",
    title: item.snippet?.title?.trim() || undefined,
    thumbnailUrl: thumbnailUrl?.trim() || undefined,
    canonicalUrl: `https://www.youtube.com/watch?v=${input.videoId}`
  };
};

const fetchYoutubeMetadataFromOEmbed = async (input: {
  canonicalUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<MetadataOutcome> => {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", input.canonicalUrl);
  endpoint.searchParams.set("format", "json");

  const timeout = withTimeoutSignal(input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetchImpl(endpoint.toString(), {
      method: "GET",
      signal: timeout.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "zappy-assistant/1.8 (downloads-youtube-oembed)"
      }
    });
  } catch (error) {
    timeout.clear();
    return {
      status: "error",
      reason: error instanceof Error && error.name === "AbortError" ? "metadata_timeout" : "metadata_network_error"
    };
  } finally {
    timeout.clear();
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: "login_required",
      reason: `youtube_oembed_http_${response.status}`
    };
  }

  if (response.status === 404) {
    return {
      status: "invalid",
      reason: "youtube_video_not_found"
    };
  }

  if (!response.ok) {
    return {
      status: "error",
      reason: `youtube_oembed_http_${response.status}`
    };
  }

  const parsed = await parseJsonSafely<{
    title?: string;
    thumbnail_url?: string;
  }>(response);

  return {
    status: "ok",
    title: parsed?.title?.trim() || undefined,
    thumbnailUrl: parsed?.thumbnail_url?.trim() || undefined,
    canonicalUrl: input.canonicalUrl
  };
};

const fetchYoutubeMetadata = async (input: {
  permalink: YoutubePermalink;
  apiKey?: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<MetadataOutcome> => {
  if (input.permalink.videoId && input.apiKey) {
    const fromDataApi = await fetchYoutubeMetadataFromDataApi({
      apiKey: input.apiKey,
      videoId: input.permalink.videoId,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl
    });

    if (fromDataApi?.status === "ok" || fromDataApi?.status === "private" || fromDataApi?.status === "login_required") {
      return fromDataApi;
    }

    if (fromDataApi?.status === "error") {
      const fallback = await fetchYoutubeMetadataFromOEmbed({
        canonicalUrl: input.permalink.normalizedUrl,
        timeoutMs: input.timeoutMs,
        fetchImpl: input.fetchImpl
      });
      if (fallback.status === "ok") return fallback;
      return {
        status: "error",
        reason: `${fromDataApi.reason};${fallback.reason}`
      };
    }
  }

  return fetchYoutubeMetadataFromOEmbed({
    canonicalUrl: input.permalink.normalizedUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl
  });
};

const resolveYoutubeProbe = async (input: {
  request: DownloadProviderProbeInput;
  complianceMode: ComplianceMode;
  blockedReason: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  apiKey?: string;
  logger?: LoggerPort;
}): Promise<{ probe: DownloadProbeResult; page?: YoutubeResolvedPage }> => {
  const permalink = parseYoutubePermalink(input.request.url);
  if (!permalink) {
    const probe: DownloadProbeResult = {
      provider: "yt",
      status: "invalid",
      resultKind: "unsupported",
      sourceUrl: input.request.url,
      reason: "invalid_youtube_url"
    };
    logYoutubeInfo(
      input.logger,
      "youtube_probe_kind",
      {
        sourceUrl: input.request.url,
        probeStatus: probe.status,
        resultKind: probe.resultKind,
        reason: probe.reason
      },
      "youtube probe kind resolved"
    );
    return { probe };
  }

  if (input.complianceMode === "blocked") {
    const probe: DownloadProbeResult = {
      provider: "yt",
      status: "blocked",
      resultKind: "blocked",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: input.blockedReason
    };
    logYoutubeInfo(
      input.logger,
      "youtube_probe_kind",
      {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        resultKind: probe.resultKind,
        reason: probe.reason
      },
      "youtube probe kind resolved"
    );
    return { probe };
  }

  if (permalink.kind === "unknown" || permalink.kind === "clip" || !permalink.videoId) {
    const probe: DownloadProbeResult = {
      provider: "yt",
      status: "unsupported",
      resultKind: "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: "unsupported_youtube_path"
    };
    logYoutubeInfo(
      input.logger,
      "youtube_probe_kind",
      {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        resultKind: probe.resultKind,
        reason: probe.reason
      },
      "youtube probe kind resolved"
    );
    return { probe };
  }

  const metadata = await fetchYoutubeMetadata({
    permalink,
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl
  });

  if (metadata.status !== "ok") {
    const probe: DownloadProbeResult = {
      provider: "yt",
      status:
        metadata.status === "private" || metadata.status === "login_required"
          ? "blocked"
          : metadata.status === "invalid"
            ? "invalid"
            : "error",
      resultKind:
        metadata.status === "private"
          ? "private"
          : metadata.status === "login_required"
            ? "login_required"
            : "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: metadata.reason
    };

    if (metadata.status === "error") {
      logYoutubeWarn(
        input.logger,
        "youtube_probe_kind",
        {
          sourceUrl: permalink.sourceUrl,
          canonicalUrl: probe.canonicalUrl,
          pathKind: permalink.kind,
          probeStatus: probe.status,
          resultKind: probe.resultKind,
          reason: probe.reason
        },
        "youtube probe failed"
      );
    } else {
      logYoutubeInfo(
        input.logger,
        "youtube_probe_kind",
        {
          sourceUrl: permalink.sourceUrl,
          canonicalUrl: probe.canonicalUrl,
          pathKind: permalink.kind,
          probeStatus: probe.status,
          resultKind: probe.resultKind,
          reason: probe.reason
        },
        "youtube probe kind resolved"
      );
    }

    return { probe };
  }

  const probeKind: YoutubeProbeKind = permalink.kind === "shorts" ? "reel_video" : "video_post";
  const page: YoutubeResolvedPage = {
    sourceUrl: permalink.sourceUrl,
    canonicalUrl: metadata.canonicalUrl ?? permalink.normalizedUrl,
    kind: permalink.kind,
    probeKind,
    videoId: permalink.videoId,
    title: metadata.title,
    thumbnailUrl: metadata.thumbnailUrl
  };

  const probe: DownloadProbeResult = {
    provider: "yt",
    status: "ready",
    resultKind: probeKind,
    sourceUrl: page.sourceUrl,
    canonicalUrl: page.canonicalUrl,
    title: page.title,
    reason: "youtube_probe_ready",
    metadata: {
      mimeType: "video/mp4"
    }
  };

  logYoutubeInfo(
    input.logger,
    "youtube_probe_kind",
    {
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: probe.canonicalUrl,
      pathKind: permalink.kind,
      probeStatus: probe.status,
      resultKind: probe.resultKind,
      reason: probe.reason
    },
    "youtube probe kind resolved"
  );

  return { probe, page };
};

const resolveAsset = async (input: {
  probe: DownloadProbeResult;
  request: DownloadProviderDownloadInput;
  page?: YoutubeResolvedPage;
  complianceMode: ComplianceMode;
  blockedReason: string;
  logger?: LoggerPort;
}): Promise<
  | { ok: false; status: DownloadExecutionResult["status"]; reason: string; resultKind: DownloadProviderResultKind }
> => {
  if (input.complianceMode === "blocked") {
    return {
      ok: false,
      status: "blocked",
      reason: input.blockedReason,
      resultKind: "blocked"
    };
  }

  if (input.probe.status !== "ready") {
    return {
      ok: false,
      status: input.probe.status,
      reason: input.probe.reason ?? "probe_not_ready",
      resultKind: input.probe.resultKind ?? normalizeYoutubeResultKind({ status: input.probe.status, reason: input.probe.reason })
    };
  }

  logYoutubeInfo(
    input.logger,
    "youtube_asset_resolve_started",
    {
      sourceUrl: input.page?.sourceUrl ?? input.probe.sourceUrl,
      canonicalUrl: input.page?.canonicalUrl ?? input.probe.canonicalUrl,
      reason: "official_api_metadata_only"
    },
    "youtube asset resolve started"
  );

  logYoutubeInfo(
    input.logger,
    "youtube_asset_resolve_preview_only",
    {
      sourceUrl: input.page?.sourceUrl ?? input.probe.sourceUrl,
      canonicalUrl: input.page?.canonicalUrl ?? input.probe.canonicalUrl,
      reason: "preview_only"
    },
    "youtube asset resolve preview only"
  );

  return {
    ok: false,
    status: "unsupported",
    reason: "preview_only",
    resultKind: "preview_only"
  };
};

const downloadResolvedAsset = async (input: {
  probe: DownloadProbeResult;
  page?: YoutubeResolvedPage;
  logger?: LoggerPort;
}): Promise<
  | { ok: false; status: DownloadExecutionResult["status"]; reason: string; resultKind: DownloadProviderResultKind }
> => {
  logYoutubeInfo(
    input.logger,
    "youtube_download_preview_only",
    {
      sourceUrl: input.page?.sourceUrl ?? input.probe.sourceUrl,
      canonicalUrl: input.page?.canonicalUrl ?? input.probe.canonicalUrl,
      reason: "preview_only"
    },
    "youtube download preview only"
  );

  return {
    ok: false,
    status: "unsupported",
    reason: "preview_only",
    resultKind: "preview_only"
  };
};

const normalizeForWhatsApp = (input: {
  execution: DownloadExecutionResult;
  page?: YoutubeResolvedPage;
}): DownloadExecutionResult => ({
  ...input.execution,
  provider: "yt",
  sourceUrl: input.page?.sourceUrl ?? input.execution.sourceUrl,
  canonicalUrl: input.execution.canonicalUrl ?? input.page?.canonicalUrl,
  resultKind:
    input.execution.resultKind ??
    normalizeYoutubeResultKind({
      status: input.execution.status,
      reason: input.execution.reason,
      probeKind: input.page?.probeKind
    })
});

const executeDownloadFromProbe = async (input: {
  probe: DownloadProbeResult;
  request: DownloadProviderDownloadInput;
  page?: YoutubeResolvedPage;
  complianceMode: ComplianceMode;
  blockedReason: string;
  logger?: LoggerPort;
}): Promise<DownloadExecutionResult> => {
  const resolvedAsset = await resolveAsset({
    probe: input.probe,
    request: input.request,
    page: input.page,
    complianceMode: input.complianceMode,
    blockedReason: input.blockedReason,
    logger: input.logger
  });

  if (!resolvedAsset.ok) {
    return normalizeForWhatsApp({
      execution: {
        provider: "yt",
        status: resolvedAsset.status,
        resultKind: resolvedAsset.resultKind,
        sourceUrl: input.page?.sourceUrl ?? input.probe.sourceUrl,
        canonicalUrl: input.page?.canonicalUrl ?? input.probe.canonicalUrl,
        title: input.page?.title ?? input.probe.title,
        reason: resolvedAsset.reason,
        assets: []
      },
      page: input.page
    });
  }

  const downloaded = await downloadResolvedAsset({
    probe: input.probe,
    page: input.page,
    logger: input.logger
  });

  if (!downloaded.ok) {
    return normalizeForWhatsApp({
      execution: {
        provider: "yt",
        status: downloaded.status,
        resultKind: downloaded.resultKind,
        sourceUrl: input.page?.sourceUrl ?? input.probe.sourceUrl,
        canonicalUrl: input.page?.canonicalUrl ?? input.probe.canonicalUrl,
        title: input.page?.title ?? input.probe.title,
        reason: downloaded.reason,
        assets: []
      },
      page: input.page
    });
  }

  return normalizeForWhatsApp({
    execution: {
      provider: "yt",
      status: "unsupported",
      resultKind: "preview_only",
      sourceUrl: input.page?.sourceUrl ?? input.probe.sourceUrl,
      canonicalUrl: input.page?.canonicalUrl ?? input.probe.canonicalUrl,
      title: input.page?.title ?? input.probe.title,
      reason: "preview_only",
      assets: []
    },
    page: input.page
  });
};

export const createYoutubeDownloadProvider = (input?: YoutubeProviderInput): DownloadProviderAdapter => {
  const logger = input?.logger;
  const complianceMode = input?.complianceMode ?? "blocked";
  const blockedReason = (input?.blockedReason ?? DEFAULT_BLOCKED_REASON).trim() || DEFAULT_BLOCKED_REASON;
  const timeoutMs = input?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = input?.fetchImpl ?? fetch;

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
        timeoutMs,
        fetchImpl,
        apiKey: input?.apiKey,
        logger
      });
      return resolved.probe;
    },
    downloadWithProbe: async (inputValue) => {
      if (inputValue.probe.status !== "ready") return mapProbeToExecution(inputValue.probe);

      const refreshed = await resolveYoutubeProbe({
        request: inputValue.request,
        complianceMode,
        blockedReason,
        timeoutMs,
        fetchImpl,
        apiKey: input?.apiKey,
        logger
      });
      if (refreshed.probe.status !== "ready") return mapProbeToExecution(refreshed.probe);

      return executeDownloadFromProbe({
        probe: refreshed.probe,
        request: inputValue.request,
        page: refreshed.page,
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
        timeoutMs,
        fetchImpl,
        apiKey: input?.apiKey,
        logger
      });
      if (resolved.probe.status !== "ready") return mapProbeToExecution(resolved.probe);
      return executeDownloadFromProbe({
        probe: resolved.probe,
        request,
        page: resolved.page,
        complianceMode,
        blockedReason,
        logger
      });
    }
  };
};
