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

type FacebookContentKind = "watch" | "video_path" | "reel" | "share" | "unknown";
type ComplianceMode = "blocked" | "prepare_only";
type FacebookProbeKind = "preview_only" | "video_post" | "reel_video";

interface FacebookPermalink {
  sourceUrl: string;
  normalizedUrl: string;
  kind: FacebookContentKind;
  videoId?: string;
}

interface FacebookResolvedPage {
  sourceUrl: string;
  canonicalUrl: string;
  kind: FacebookContentKind;
  probeKind: FacebookProbeKind;
  title?: string;
  thumbnailUrl?: string;
  videoCandidates: string[];
}

interface FacebookResolvedAssetCandidate {
  kind: "video";
  url: string;
  mimeTypeHint?: string;
  sizeBytesHint?: number;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FacebookProviderInput {
  logger?: LoggerPort;
  complianceMode?: ComplianceMode;
  blockedReason?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  userAgent?: string;
  maxBytes?: number;
  accessToken?: string;
  graphApiVersion?: string;
}

const DEFAULT_BLOCKED_REASON = "Provider Facebook permanece bloqueado por politica de compliance/licenciamento.";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_HTML_BYTES = 1_500_000;
const DEFAULT_USER_AGENT = "zappy-assistant/1.8 (downloads-facebook)";

const normalizeHost = (rawHost: string): string => rawHost.trim().toLowerCase().replace(/^www\./, "");
const normalizeMimeType = (value?: string | null): string => (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

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

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const decodeEmbeddedUrl = (value: string): string =>
  decodeHtmlEntities(value)
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u002F/gi, "/")
    .trim();

const toAbsoluteUrl = (value: string, baseUrl: string): string | null => {
  const candidate = decodeEmbeddedUrl(value);
  if (!candidate) return null;
  try {
    const absolute = new URL(candidate, baseUrl);
    if (!["http:", "https:"].includes(absolute.protocol)) return null;
    return absolute.toString();
  } catch {
    return null;
  }
};

const collectUrlsFromRegex = (input: {
  html: string;
  regex: RegExp;
  baseUrl: string;
}): string[] => {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = input.regex.exec(input.html)) !== null) {
    const raw = match[1] ?? "";
    const absolute = toAbsoluteUrl(raw, input.baseUrl);
    if (absolute) matches.push(absolute);
  }
  return matches;
};

const dedupeUrls = (values: Array<string | undefined | null>): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
};

const collectVideoCandidates = (input: {
  html: string;
  canonicalUrl: string;
  ogVideo?: string;
}): string[] =>
  dedupeUrls([
    input.ogVideo ? toAbsoluteUrl(input.ogVideo, input.canonicalUrl) : null,
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /<meta[^>]+property=["']og:video:secure_url["'][^>]*content=["']([^"']+)["'][^>]*>/gi,
      baseUrl: input.canonicalUrl
    }),
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /<meta[^>]+property=["']og:video:url["'][^>]*content=["']([^"']+)["'][^>]*>/gi,
      baseUrl: input.canonicalUrl
    }),
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /"playable_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      baseUrl: input.canonicalUrl
    }),
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /"browser_native_sd_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      baseUrl: input.canonicalUrl
    }),
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /"browser_native_hd_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      baseUrl: input.canonicalUrl
    })
  ]);

const extractMetaContent = (html: string, key: string): string | undefined => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyRegex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const contentRegex = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${escapedKey}["'][^>]*>`,
    "i"
  );
  const match = propertyRegex.exec(html) ?? contentRegex.exec(html);
  if (!match?.[1]) return undefined;
  return decodeHtmlEntities(match[1]).trim();
};

const containsLoginMarkers = (html: string): boolean => {
  const lower = html.toLowerCase();
  return (
    lower.includes("log in to facebook") ||
    lower.includes("you must log in") ||
    lower.includes("login to continue")
  );
};

const containsPrivateMarkers = (html: string): boolean => {
  const lower = html.toLowerCase();
  return (
    lower.includes("this content isn't available right now") ||
    lower.includes("this video is unavailable") ||
    lower.includes("you may not have permission")
  );
};

const containsUnavailableMarkers = (html: string): boolean => {
  const lower = html.toLowerCase();
  return (
    lower.includes("the link you followed may be broken") ||
    lower.includes("page isn't available") ||
    lower.includes("content not found")
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

const buildHeaders = (userAgent: string, accept: string): HeadersInit => ({
  "User-Agent": userAgent,
  Accept: accept,
  "Accept-Language": "en-US,en;q=0.9"
});

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

const parseJsonSafely = async <T>(response: Response): Promise<T | null> => {
  try {
    const raw = await response.text();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const fetchGraphMetadata = async (input: {
  videoId?: string;
  accessToken?: string;
  graphApiVersion: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<
  | { status: "skipped" }
  | { status: "ok"; title?: string; thumbnailUrl?: string; canonicalUrl?: string }
  | { status: "private" | "login_required" | "error"; reason: string }
> => {
  if (!input.videoId || !input.accessToken) return { status: "skipped" };

  const endpoint = new URL(`https://graph.facebook.com/${input.graphApiVersion}/${input.videoId}`);
  endpoint.searchParams.set("fields", "id,title,permalink_url,thumbnails");
  endpoint.searchParams.set("access_token", input.accessToken);

  const timeout = withTimeoutSignal(input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetchImpl(endpoint.toString(), {
      method: "GET",
      signal: timeout.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": DEFAULT_USER_AGENT
      }
    });
  } catch (error) {
    timeout.clear();
    return {
      status: "error",
      reason: error instanceof Error && error.name === "AbortError" ? "graph_timeout" : "graph_network_error"
    };
  } finally {
    timeout.clear();
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: "login_required",
      reason: `facebook_graph_http_${response.status}`
    };
  }

  if (response.status === 404) {
    return {
      status: "private",
      reason: "private"
    };
  }

  if (!response.ok) {
    return {
      status: "error",
      reason: `facebook_graph_http_${response.status}`
    };
  }

  const parsed = await parseJsonSafely<{
    title?: string;
    permalink_url?: string;
    thumbnails?: {
      data?: Array<{ uri?: string }>;
    };
  }>(response);

  return {
    status: "ok",
    title: parsed?.title?.trim() || undefined,
    canonicalUrl: parsed?.permalink_url?.trim() || undefined,
    thumbnailUrl: parsed?.thumbnails?.data?.[0]?.uri?.trim() || undefined
  };
};

const resolveFacebookResultKind = (input: {
  status: DownloadExecutionResult["status"];
  reason?: string;
  probeKind?: FacebookProbeKind;
  assetKind?: "video";
}): DownloadProviderResultKind => {
  const reason = (input.reason ?? "").toLowerCase();
  if (reason.includes("preview_only")) return "preview_only";
  if (reason.includes("private")) return "private";
  if (reason.includes("login")) return "login_required";
  if (input.status === "blocked") return "blocked";
  if (input.assetKind === "video" && input.probeKind === "reel_video") return "reel_video";
  if (input.assetKind === "video") return "video_post";
  if (input.probeKind === "reel_video") return "reel_video";
  if (input.probeKind === "video_post") return "video_post";
  return "unsupported";
};

const looksLikeMp4Container = (bytes: Buffer): boolean =>
  bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";

const readResponseBufferWithinLimit = async (response: Response, maxBytes: number): Promise<Buffer> => {
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.length > maxBytes) throw new Error("max_bytes_exceeded");
    return fallback;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // noop
      }
      throw new Error("max_bytes_exceeded");
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
};

const resolveFacebookProbe = async (input: {
  request: DownloadProviderProbeInput;
  complianceMode: ComplianceMode;
  blockedReason: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  userAgent: string;
  accessToken?: string;
  graphApiVersion: string;
  logger?: LoggerPort;
}): Promise<{ probe: DownloadProbeResult; page?: FacebookResolvedPage }> => {
  const permalink = parseFacebookPermalink(input.request.url);
  if (!permalink) {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "invalid",
      resultKind: "unsupported",
      sourceUrl: input.request.url,
      reason: "invalid_facebook_url"
    };
    logFacebookInfo(
      input.logger,
      "facebook_probe_kind",
      {
        sourceUrl: input.request.url,
        probeStatus: probe.status,
        resultKind: probe.resultKind,
        reason: probe.reason
      },
      "facebook probe kind resolved"
    );
    return { probe };
  }

  if (input.complianceMode === "blocked") {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "blocked",
      resultKind: "blocked",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: input.blockedReason
    };
    logFacebookInfo(
      input.logger,
      "facebook_probe_kind",
      {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        resultKind: probe.resultKind,
        reason: probe.reason
      },
      "facebook probe kind resolved"
    );
    return { probe };
  }

  if (permalink.kind === "unknown") {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "unsupported",
      resultKind: "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: "unsupported_facebook_path"
    };
    logFacebookInfo(
      input.logger,
      "facebook_probe_kind",
      {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        resultKind: probe.resultKind,
        reason: probe.reason
      },
      "facebook probe kind resolved"
    );
    return { probe };
  }

  const graphMetadata = await fetchGraphMetadata({
    videoId: permalink.videoId,
    accessToken: input.accessToken,
    graphApiVersion: input.graphApiVersion,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl
  });

  if (graphMetadata.status === "private") {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "blocked",
      resultKind: "private",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: graphMetadata.reason
    };
    return { probe };
  }

  if (graphMetadata.status === "login_required") {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "blocked",
      resultKind: "login_required",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason: graphMetadata.reason
    };
    return { probe };
  }

  const timeout = withTimeoutSignal(input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetchImpl(permalink.normalizedUrl, {
      method: "GET",
      redirect: "follow",
      signal: timeout.signal,
      headers: buildHeaders(input.userAgent, "text/html,application/xhtml+xml")
    });
  } catch (error) {
    timeout.clear();
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "error",
      resultKind: "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: permalink.normalizedUrl,
      reason
    };
    logFacebookWarn(
      input.logger,
      "facebook_probe_kind",
      {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        resultKind: probe.resultKind,
        reason
      },
      "facebook probe failed"
    );
    return { probe };
  } finally {
    timeout.clear();
  }

  if (!response.ok) {
    const status: DownloadProbeResult["status"] =
      response.status === 401 || response.status === 403
        ? "blocked"
        : response.status === 404
          ? "invalid"
          : "error";
    const probe: DownloadProbeResult = {
      provider: "fb",
      status,
      resultKind:
        status === "blocked"
          ? "login_required"
          : status === "invalid"
            ? "unsupported"
            : "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: response.url || permalink.normalizedUrl,
      reason: `http_${response.status}`
    };
    return { probe };
  }

  const contentType = normalizeMimeType(response.headers.get("content-type"));
  if (contentType && !contentType.includes("html")) {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "unsupported",
      resultKind: "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: response.url || permalink.normalizedUrl,
      reason: "unexpected_content_type",
      metadata: {
        mimeType: contentType
      }
    };
    return { probe };
  }

  const htmlContentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(htmlContentLength) && htmlContentLength > DEFAULT_MAX_HTML_BYTES) {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "error",
      resultKind: "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: response.url || permalink.normalizedUrl,
      reason: "html_payload_too_large"
    };
    return { probe };
  }

  const html = await response.text();
  if (Buffer.byteLength(html, "utf-8") > DEFAULT_MAX_HTML_BYTES) {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "error",
      resultKind: "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: response.url || permalink.normalizedUrl,
      reason: "html_payload_too_large"
    };
    return { probe };
  }

  if (containsLoginMarkers(html)) {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "blocked",
      resultKind: "login_required",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: response.url || permalink.normalizedUrl,
      reason: "login_required"
    };
    return { probe };
  }

  if (containsPrivateMarkers(html)) {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "blocked",
      resultKind: "private",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: response.url || permalink.normalizedUrl,
      reason: "private"
    };
    return { probe };
  }

  if (containsUnavailableMarkers(html)) {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "invalid",
      resultKind: "unsupported",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: response.url || permalink.normalizedUrl,
      reason: "content_unavailable"
    };
    return { probe };
  }

  const ogUrl = extractMetaContent(html, "og:url") ?? response.url ?? permalink.normalizedUrl;
  const ogTitle =
    graphMetadata.status === "ok"
      ? graphMetadata.title
      : extractMetaContent(html, "og:title") ?? extractMetaContent(html, "og:description");
  const ogVideo = extractMetaContent(html, "og:video:secure_url") ?? extractMetaContent(html, "og:video:url") ?? extractMetaContent(html, "og:video");
  const ogImage =
    graphMetadata.status === "ok"
      ? graphMetadata.thumbnailUrl
      : extractMetaContent(html, "og:image:secure_url") ?? extractMetaContent(html, "og:image");

  const videoCandidates = collectVideoCandidates({
    html,
    canonicalUrl: ogUrl,
    ogVideo: ogVideo ?? undefined
  });

  const probeKind: FacebookProbeKind =
    videoCandidates.length > 0
      ? permalink.kind === "reel" || (permalink.kind === "share" && permalink.normalizedUrl.includes("/reel/"))
        ? "reel_video"
        : "video_post"
      : ogImage
        ? "preview_only"
        : "preview_only";

  if (probeKind === "preview_only" || videoCandidates.length === 0) {
    const probe: DownloadProbeResult = {
      provider: "fb",
      status: "unsupported",
      resultKind: "preview_only",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: ogUrl,
      title: ogTitle || undefined,
      reason: "preview_only",
      metadata: {
        mimeType: "image/jpeg"
      }
    };
    return { probe };
  }

  const page: FacebookResolvedPage = {
    sourceUrl: permalink.sourceUrl,
    canonicalUrl: graphMetadata.status === "ok" ? graphMetadata.canonicalUrl ?? ogUrl : ogUrl,
    kind: permalink.kind,
    probeKind,
    title: ogTitle || undefined,
    thumbnailUrl: ogImage || undefined,
    videoCandidates
  };

  const probe: DownloadProbeResult = {
    provider: "fb",
    status: "ready",
    resultKind: probeKind,
    sourceUrl: page.sourceUrl,
    canonicalUrl: page.canonicalUrl,
    title: page.title,
    reason: "facebook_probe_ready",
    metadata: {
      mimeType: "video/mp4"
    }
  };

  logFacebookInfo(
    input.logger,
    "facebook_probe_kind",
    {
      sourceUrl: permalink.sourceUrl,
      canonicalUrl: probe.canonicalUrl,
      pathKind: permalink.kind,
      probeStatus: probe.status,
      resultKind: probe.resultKind,
      reason: probe.reason,
      videoCandidates: page.videoCandidates.length
    },
    "facebook probe kind resolved"
  );

  return { probe, page };
};

const resolveAsset = async (input: {
  probe: DownloadProbeResult;
  request: DownloadProviderDownloadInput;
  page?: FacebookResolvedPage;
  complianceMode: ComplianceMode;
  blockedReason: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  userAgent: string;
  maxBytes: number;
  logger?: LoggerPort;
}): Promise<
  | { ok: true; asset: FacebookResolvedAssetCandidate }
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
      resultKind: input.probe.resultKind ?? resolveFacebookResultKind({ status: input.probe.status, reason: input.probe.reason })
    };
  }

  const candidateUrl = input.page?.videoCandidates[0];
  if (!candidateUrl) {
    return {
      ok: false,
      status: "unsupported",
      reason: "preview_only",
      resultKind: "preview_only"
    };
  }

  logFacebookInfo(
    input.logger,
    "facebook_asset_resolve_started",
    {
      sourceUrl: input.page?.sourceUrl ?? input.probe.sourceUrl,
      canonicalUrl: input.page?.canonicalUrl ?? input.probe.canonicalUrl,
      probeKind: input.page?.probeKind,
      assetUrlPreview: candidateUrl.slice(0, 220)
    },
    "facebook asset resolve started"
  );

  const timeout = withTimeoutSignal(input.timeoutMs);
  let headResponse: Response | null = null;
  try {
    headResponse = await input.fetchImpl(candidateUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: timeout.signal,
      headers: buildHeaders(input.userAgent, "*/*")
    });
  } catch {
    headResponse = null;
  } finally {
    timeout.clear();
  }

  if (headResponse && !headResponse.ok && headResponse.status !== 405) {
    const status: DownloadExecutionResult["status"] =
      headResponse.status === 401 || headResponse.status === 403
        ? "blocked"
        : headResponse.status === 404
          ? "invalid"
          : "error";

    return {
      ok: false,
      status,
      reason: `asset_head_http_${headResponse.status}`,
      resultKind:
        status === "blocked"
          ? "login_required"
          : status === "invalid"
            ? "unsupported"
            : "unsupported"
    };
  }

  const mimeTypeHint = normalizeMimeType(headResponse?.headers.get("content-type"));
  const rawLength = Number(headResponse?.headers.get("content-length") ?? "0");
  const sizeBytesHint = Number.isFinite(rawLength) && rawLength > 0 ? rawLength : undefined;

  const effectiveMaxBytes = input.request.maxBytes ?? input.maxBytes;
  if (sizeBytesHint && sizeBytesHint > effectiveMaxBytes) {
    return {
      ok: false,
      status: "blocked",
      reason: "max_bytes_exceeded",
      resultKind: "blocked"
    };
  }

  if (mimeTypeHint && mimeTypeHint.startsWith("image/")) {
    return {
      ok: false,
      status: "unsupported",
      reason: "preview_only",
      resultKind: "preview_only"
    };
  }

  if (mimeTypeHint && !mimeTypeHint.startsWith("video/")) {
    return {
      ok: false,
      status: "unsupported",
      reason: "unexpected_media_content_type",
      resultKind: "unsupported"
    };
  }

  return {
    ok: true,
    asset: {
      kind: "video",
      url: headResponse?.url || candidateUrl,
      mimeTypeHint: mimeTypeHint || undefined,
      sizeBytesHint
    }
  };
};

const downloadResolvedAsset = async (input: {
  asset: FacebookResolvedAssetCandidate;
  page: FacebookResolvedPage;
  request: DownloadProviderDownloadInput;
  timeoutMs: number;
  fetchImpl: FetchLike;
  userAgent: string;
  maxBytes: number;
  logger?: LoggerPort;
}): Promise<DownloadExecutionResult> => {
  const effectiveMaxBytes = input.request.maxBytes ?? input.maxBytes;
  if (input.asset.sizeBytesHint && input.asset.sizeBytesHint > effectiveMaxBytes) {
    return {
      provider: "fb",
      status: "blocked",
      resultKind: "blocked",
      sourceUrl: input.page.sourceUrl,
      canonicalUrl: input.page.canonicalUrl,
      title: input.page.title,
      reason: "max_bytes_exceeded",
      assets: []
    };
  }

  const timeout = withTimeoutSignal(input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetchImpl(input.asset.url, {
      method: "GET",
      redirect: "follow",
      signal: timeout.signal,
      headers: buildHeaders(input.userAgent, "*/*")
    });
  } catch (error) {
    timeout.clear();
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    return {
      provider: "fb",
      status: "error",
      resultKind: "unsupported",
      sourceUrl: input.page.sourceUrl,
      canonicalUrl: input.page.canonicalUrl,
      title: input.page.title,
      reason,
      assets: []
    };
  } finally {
    timeout.clear();
  }

  if (!response.ok) {
    const status: DownloadExecutionResult["status"] =
      response.status === 401 || response.status === 403
        ? "blocked"
        : response.status === 404
          ? "invalid"
          : "error";
    return {
      provider: "fb",
      status,
      resultKind:
        status === "blocked"
          ? "login_required"
          : status === "invalid"
            ? "unsupported"
            : "unsupported",
      sourceUrl: input.page.sourceUrl,
      canonicalUrl: input.page.canonicalUrl,
      title: input.page.title,
      reason: `media_http_${response.status}`,
      assets: []
    };
  }

  const contentType = normalizeMimeType(response.headers.get("content-type"));
  if (contentType && !contentType.startsWith("video/")) {
    const reason = contentType.startsWith("image/") ? "preview_only" : "unexpected_media_content_type";
    return {
      provider: "fb",
      status: "unsupported",
      resultKind: reason === "preview_only" ? "preview_only" : "unsupported",
      sourceUrl: input.page.sourceUrl,
      canonicalUrl: input.page.canonicalUrl,
      title: input.page.title,
      reason,
      assets: []
    };
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > effectiveMaxBytes) {
    return {
      provider: "fb",
      status: "blocked",
      resultKind: "blocked",
      sourceUrl: input.page.sourceUrl,
      canonicalUrl: input.page.canonicalUrl,
      title: input.page.title,
      reason: "max_bytes_exceeded",
      assets: []
    };
  }

  let mediaBuffer: Buffer;
  try {
    mediaBuffer = await readResponseBufferWithinLimit(response, effectiveMaxBytes);
  } catch (error) {
    const reason = error instanceof Error && error.message === "max_bytes_exceeded" ? "max_bytes_exceeded" : "media_download_failed";
    return {
      provider: "fb",
      status: reason === "max_bytes_exceeded" ? "blocked" : "error",
      resultKind: reason === "max_bytes_exceeded" ? "blocked" : "unsupported",
      sourceUrl: input.page.sourceUrl,
      canonicalUrl: input.page.canonicalUrl,
      title: input.page.title,
      reason,
      assets: []
    };
  }

  const normalizedContentType = contentType || input.asset.mimeTypeHint || "application/octet-stream";
  if (!(normalizedContentType === "video/mp4" || (normalizedContentType.startsWith("video/") && looksLikeMp4Container(mediaBuffer)))) {
    return {
      provider: "fb",
      status: "unsupported",
      resultKind: "unsupported",
      sourceUrl: input.page.sourceUrl,
      canonicalUrl: input.page.canonicalUrl,
      title: input.page.title,
      reason: "video_not_mp4",
      assets: []
    };
  }

  return {
    provider: "fb",
    status: "ready",
    resultKind: input.page.probeKind === "reel_video" ? "reel_video" : "video_post",
    sourceUrl: input.page.sourceUrl,
    canonicalUrl: input.page.canonicalUrl,
    title: input.page.title,
    reason: "download_ready",
    assets: [
      {
        kind: "video",
        mimeType: "video/mp4",
        fileName: `fb-${Date.now().toString(36)}.mp4`,
        sizeBytes: mediaBuffer.length,
        thumbnailUrl: input.page.thumbnailUrl,
        directUrl: response.url || input.asset.url,
        bufferBase64: mediaBuffer.toString("base64")
      }
    ]
  };
};

const normalizeForWhatsApp = (input: {
  execution: DownloadExecutionResult;
  page?: FacebookResolvedPage;
}): DownloadExecutionResult => ({
  ...input.execution,
  provider: "fb",
  sourceUrl: input.page?.sourceUrl ?? input.execution.sourceUrl,
  canonicalUrl: input.execution.canonicalUrl ?? input.page?.canonicalUrl,
  resultKind:
    input.execution.resultKind ??
    resolveFacebookResultKind({
      status: input.execution.status,
      reason: input.execution.reason,
      probeKind: input.page?.probeKind,
      assetKind: input.execution.assets[0]?.kind === "video" ? "video" : undefined
    })
});

const executeDownloadFromProbe = async (input: {
  probe: DownloadProbeResult;
  request: DownloadProviderDownloadInput;
  page?: FacebookResolvedPage;
  complianceMode: ComplianceMode;
  blockedReason: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  userAgent: string;
  maxBytes: number;
  logger?: LoggerPort;
}): Promise<DownloadExecutionResult> => {
  const resolvedAsset = await resolveAsset({
    probe: input.probe,
    request: input.request,
    page: input.page,
    complianceMode: input.complianceMode,
    blockedReason: input.blockedReason,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    userAgent: input.userAgent,
    maxBytes: input.maxBytes,
    logger: input.logger
  });

  if (!resolvedAsset.ok) {
    return normalizeForWhatsApp({
      execution: {
        provider: "fb",
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

  if (!input.page) {
    return {
      provider: "fb",
      status: "invalid",
      resultKind: "unsupported",
      sourceUrl: input.probe.sourceUrl,
      canonicalUrl: input.probe.canonicalUrl,
      reason: "invalid_facebook_url",
      assets: []
    };
  }

  const downloaded = await downloadResolvedAsset({
    asset: resolvedAsset.asset,
    page: input.page,
    request: input.request,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    userAgent: input.userAgent,
    maxBytes: input.maxBytes,
    logger: input.logger
  });

  return normalizeForWhatsApp({
    execution: downloaded,
    page: input.page
  });
};

export const createFacebookDownloadProvider = (input?: FacebookProviderInput): DownloadProviderAdapter => {
  const logger = input?.logger;
  const complianceMode = input?.complianceMode ?? "blocked";
  const blockedReason = (input?.blockedReason ?? DEFAULT_BLOCKED_REASON).trim() || DEFAULT_BLOCKED_REASON;
  const timeoutMs = input?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = input?.fetchImpl ?? fetch;
  const userAgent = input?.userAgent ?? DEFAULT_USER_AGENT;
  const maxBytes = input?.maxBytes ?? DEFAULT_MAX_BYTES;
  const graphApiVersion = (input?.graphApiVersion ?? "v23.0").replace(/^\/+/, "");

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
        timeoutMs,
        fetchImpl,
        userAgent,
        accessToken: input?.accessToken,
        graphApiVersion,
        logger
      });
      return resolved.probe;
    },
    downloadWithProbe: async (inputValue) => {
      if (inputValue.probe.status !== "ready") return mapProbeToExecution(inputValue.probe);

      const refreshed = await resolveFacebookProbe({
        request: inputValue.request,
        complianceMode,
        blockedReason,
        timeoutMs,
        fetchImpl,
        userAgent,
        accessToken: input?.accessToken,
        graphApiVersion,
        logger
      });
      if (refreshed.probe.status !== "ready") return mapProbeToExecution(refreshed.probe);

      return executeDownloadFromProbe({
        probe: refreshed.probe,
        request: inputValue.request,
        page: refreshed.page,
        complianceMode,
        blockedReason,
        timeoutMs,
        fetchImpl,
        userAgent,
        maxBytes,
        logger
      });
    },
    download: async (request: DownloadProviderDownloadInput): Promise<DownloadExecutionResult> => {
      const resolved = await resolveFacebookProbe({
        request,
        complianceMode,
        blockedReason,
        timeoutMs,
        fetchImpl,
        userAgent,
        accessToken: input?.accessToken,
        graphApiVersion,
        logger
      });
      if (resolved.probe.status !== "ready") return mapProbeToExecution(resolved.probe);
      return executeDownloadFromProbe({
        probe: resolved.probe,
        request,
        page: resolved.page,
        complianceMode,
        blockedReason,
        timeoutMs,
        fetchImpl,
        userAgent,
        maxBytes,
        logger
      });
    }
  };
};
