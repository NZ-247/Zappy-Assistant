import type {
  DownloadExecutionResult,
  DownloadProbeResult,
  DownloadProviderDetection,
  DownloadProviderDownloadInput,
  DownloadProviderProbeInput,
  LoggerPort
} from "@zappy/core";
import type { DownloadProviderAdapter } from "../types.js";

type InstagramContentKind = "post" | "reel" | "tv" | "unknown";
type InstagramMediaKind = "image" | "video";
type InstagramProbeKind = "preview_only" | "image_post" | "video_post" | "reel_video";

interface InstagramPermalink {
  sourceUrl: string;
  normalizedUrl: string;
  kind: InstagramContentKind;
  shortcode?: string;
}

interface InstagramResolvedPage {
  sourceUrl: string;
  canonicalUrl: string;
  permalinkUrl: string;
  shortcode?: string;
  kind: InstagramContentKind;
  probeKind: InstagramProbeKind;
  expectedMediaKind: InstagramMediaKind;
  mediaCandidates: string[];
  title?: string;
  thumbnailUrl?: string;
  itemCount?: number;
}

interface InstagramResolvedAssetCandidate {
  kind: InstagramMediaKind;
  url: string;
  probeKind: InstagramProbeKind;
  mimeTypeHint?: string;
  sizeBytesHint?: number;
}

export interface InstagramProviderInput {
  timeoutMs?: number;
  maxBytes?: number;
  maxHtmlBytes?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  logger?: LoggerPort;
}

class MaxBytesExceededError extends Error {
  readonly reason = "max_bytes_exceeded";

  constructor() {
    super("max_bytes_exceeded");
    this.name = "MaxBytesExceededError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_HTML_BYTES = 1_500_000;
const DEFAULT_CACHE_TTL_MS = 120_000;

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripWww = (host: string): string => host.trim().toLowerCase().replace(/^www\./, "");

const isInstagramHost = (host: string): boolean => {
  const normalized = stripWww(host);
  return normalized === "instagram.com" || normalized === "m.instagram.com";
};

const normalizeMimeType = (value?: string | null): string => (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

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

const parseInstagramPermalink = (rawUrl: string): InstagramPermalink | null => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (!isInstagramHost(parsed.hostname)) return null;

  const match = parsed.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]+)(?:\/|$)/i);
  if (!match) {
    return {
      sourceUrl: rawUrl,
      normalizedUrl: `https://www.instagram.com${parsed.pathname}`,
      kind: "unknown"
    };
  }

  const kindMap: Record<string, InstagramContentKind> = {
    p: "post",
    reel: "reel",
    tv: "tv"
  };
  const kind = kindMap[match[1].toLowerCase()] ?? "unknown";
  const shortcode = match[2];
  const pathPrefix = match[1].toLowerCase();
  return {
    sourceUrl: rawUrl,
    normalizedUrl: `https://www.instagram.com/${pathPrefix}/${shortcode}/`,
    kind,
    shortcode
  };
};

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

const extractTitleFromHtml = (html: string): string | undefined => {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  if (!match?.[1]) return undefined;
  return decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
};

const extractCarouselCount = (html: string): number | undefined => {
  const match = html.match(/"edge_sidecar_to_children"\s*:\s*\{\s*"edges"\s*:\s*\[(.*?)\]\s*\}/s);
  if (!match?.[1]) return undefined;
  const count = match[1].match(/"node"\s*:/g)?.length ?? 0;
  return count > 1 ? count : undefined;
};

const containsPrivateMarkers = (html: string): boolean => {
  const lower = html.toLowerCase();
  return (
    lower.includes("this account is private") ||
    lower.includes("private account") ||
    lower.includes("login to instagram")
  );
};

const containsUnavailableMarkers = (html: string): boolean => {
  const lower = html.toLowerCase();
  return (
    lower.includes("sorry, this page isn't available") ||
    lower.includes("page you requested couldn't be found") ||
    lower.includes("content unavailable")
  );
};

const resolveProbeStatusFromResponse = (status: number): "blocked" | "invalid" | "error" => {
  if (status === 401 || status === 403) return "blocked";
  if (status === 404) return "invalid";
  return "error";
};

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
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return null;
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

const dedupeUrls = (values: Array<string | undefined>): string[] => {
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
}): string[] => {
  const fromMeta = input.ogVideo ? toAbsoluteUrl(input.ogVideo, input.canonicalUrl) : null;
  return dedupeUrls([
    fromMeta ?? undefined,
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /"video_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      baseUrl: input.canonicalUrl
    }),
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /"contentUrl"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      baseUrl: input.canonicalUrl
    }),
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /"video_versions"\s*:\s*\[[^\]]*?"url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      baseUrl: input.canonicalUrl
    }),
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /<meta[^>]+property=["']twitter:player:stream["'][^>]*content=["']([^"']+)["'][^>]*>/gi,
      baseUrl: input.canonicalUrl
    })
  ]);
};

const collectImageCandidates = (input: {
  html: string;
  canonicalUrl: string;
  ogImage?: string;
}): string[] => {
  const fromMeta = input.ogImage ? toAbsoluteUrl(input.ogImage, input.canonicalUrl) : null;
  return dedupeUrls([
    fromMeta ?? undefined,
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /"display_url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      baseUrl: input.canonicalUrl
    }),
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /"thumbnail_src"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      baseUrl: input.canonicalUrl
    }),
    ...collectUrlsFromRegex({
      html: input.html,
      regex: /"image_versions2"\s*:\s*\{[^\}]*"candidates"\s*:\s*\[[^\]]*?"url"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
      baseUrl: input.canonicalUrl
    })
  ]);
};

const resolveProbeKind = (input: {
  permalinkKind: InstagramContentKind;
  videoCandidates: string[];
  imageCandidates: string[];
}): InstagramProbeKind | null => {
  if (input.permalinkKind === "reel" || input.permalinkKind === "tv") {
    if (input.videoCandidates.length > 0) return "reel_video";
    if (input.imageCandidates.length > 0) return "preview_only";
    return null;
  }

  if (input.permalinkKind === "post") {
    if (input.videoCandidates.length > 0) return "video_post";
    if (input.imageCandidates.length > 0) return "image_post";
    return null;
  }

  return null;
};

const resolveProbeReason = (input: {
  probeKind: InstagramProbeKind;
  itemCount?: number;
}): string => {
  if (input.probeKind === "preview_only") return "preview_only";
  if (input.itemCount && input.itemCount > 1) return "carousel_first_item_only";
  if (input.probeKind === "reel_video") return "reel_video";
  if (input.probeKind === "video_post") return "video_post";
  return "image_post";
};

const mapProbeToExecution = (probe: DownloadProbeResult): DownloadExecutionResult => ({
  provider: "ig",
  status: probe.status,
  sourceUrl: probe.sourceUrl,
  canonicalUrl: probe.canonicalUrl,
  title: probe.title,
  reason: probe.reason,
  assets: []
});

const isMimeCompatible = (mimeType: string, expectedKind: InstagramMediaKind): boolean => {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return false;
  if (expectedKind === "video") return normalized.startsWith("video/");
  return normalized.startsWith("image/");
};

const looksLikeMp4Container = (bytes: Buffer): boolean =>
  bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";

const inferImageMimeFromSignature = (bytes: Buffer): string | undefined => {
  if (bytes.length < 4) return undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  const gifSig = bytes.subarray(0, 6).toString("ascii");
  if (gifSig === "GIF87a" || gifSig === "GIF89a") return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return undefined;
};

const resolveExtensionFromMimeType = (mimeType: string): string => {
  const normalized = normalizeMimeType(mimeType);
  if (normalized === "video/mp4") return "mp4";
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  return "bin";
};

const normalizeVideoForWhatsapp = (input: {
  mimeType?: string;
  mediaBuffer: Buffer;
}): { ok: true; mimeType: "video/mp4" } | { ok: false; reason: string } => {
  const normalizedMimeType = normalizeMimeType(input.mimeType);
  if (normalizedMimeType === "video/mp4") {
    return { ok: true, mimeType: "video/mp4" };
  }
  if (looksLikeMp4Container(input.mediaBuffer) && (!normalizedMimeType || normalizedMimeType.startsWith("video/"))) {
    return { ok: true, mimeType: "video/mp4" };
  }
  if (normalizedMimeType.startsWith("image/")) {
    return { ok: false, reason: "preview_only" };
  }
  if (normalizedMimeType.startsWith("video/")) {
    return { ok: false, reason: "video_not_mp4" };
  }
  return { ok: false, reason: "unexpected_media_content_type" };
};

const readResponseBufferWithinLimit = async (response: Response, maxBytes: number): Promise<Buffer> => {
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.length > maxBytes) throw new MaxBytesExceededError();
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
      throw new MaxBytesExceededError();
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
};

const logInstagramInfo = (logger: LoggerPort | undefined, status: string, payload: Record<string, unknown>, message: string) => {
  logger?.info?.(
    {
      capability: "downloads",
      provider: "instagram",
      status,
      ...payload
    },
    message
  );
};

const logInstagramWarn = (logger: LoggerPort | undefined, status: string, payload: Record<string, unknown>, message: string) => {
  logger?.warn?.(
    {
      capability: "downloads",
      provider: "instagram",
      status,
      ...payload
    },
    message
  );
};

export const createInstagramDownloadProvider = (input?: InstagramProviderInput): DownloadProviderAdapter => {
  const timeoutMs = input?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = input?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxHtmlBytes = input?.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  const cacheTtlMs = input?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fetchImpl = input?.fetchImpl ?? fetch;
  const userAgent = input?.userAgent ?? "zappy-assistant/1.7 (downloads-instagram)";
  const logger = input?.logger;
  const probeCache = new Map<string, { page: InstagramResolvedPage; expiresAt: number }>();

  const readProbeCache = (key: string): InstagramResolvedPage | null => {
    const cached = probeCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt < Date.now()) {
      probeCache.delete(key);
      return null;
    }
    return cached.page;
  };

  const writeProbeCache = (key: string, page: InstagramResolvedPage) => {
    probeCache.set(key, { page, expiresAt: Date.now() + cacheTtlMs });
  };

  const resolveInstagramProbe = async (request: DownloadProviderProbeInput): Promise<{
    probe: DownloadProbeResult;
    page?: InstagramResolvedPage;
  }> => {
    const permalink = parseInstagramPermalink(request.url);
    if (!permalink) {
      const probe: DownloadProbeResult = {
        provider: "ig",
        status: "invalid",
        sourceUrl: request.url,
        reason: "invalid_instagram_url"
      };
      logInstagramInfo(logger, "instagram_probe_kind", {
        sourceUrl: request.url,
        probeStatus: probe.status,
        probeKind: "invalid",
        reason: probe.reason
      }, "instagram probe kind resolved");
      return { probe };
    }

    if (permalink.kind === "unknown") {
      const probe: DownloadProbeResult = {
        provider: "ig",
        status: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: permalink.normalizedUrl,
        reason: "unsupported_instagram_path"
      };
      logInstagramInfo(logger, "instagram_probe_kind", {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        probeKind: "unsupported",
        reason: probe.reason
      }, "instagram probe kind resolved");
      return { probe };
    }

    const timeout = withTimeoutSignal(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(permalink.normalizedUrl, {
        method: "GET",
        redirect: "follow",
        signal: timeout.signal,
        headers: buildHeaders(userAgent, "text/html,application/xhtml+xml")
      });
    } catch (error) {
      timeout.clear();
      const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      const probe: DownloadProbeResult = {
        provider: "ig",
        status: "error",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: permalink.normalizedUrl,
        reason
      };
      logInstagramWarn(logger, "instagram_probe_kind", {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        probeKind: "error",
        reason
      }, "instagram probe failed");
      return { probe };
    } finally {
      timeout.clear();
    }

    if (!response.ok) {
      const probe: DownloadProbeResult = {
        provider: "ig",
        status: resolveProbeStatusFromResponse(response.status),
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: response.url || permalink.normalizedUrl,
        reason: `http_${response.status}`
      };
      logInstagramInfo(logger, "instagram_probe_kind", {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        probeKind: probe.status,
        reason: probe.reason
      }, "instagram probe kind resolved");
      return { probe };
    }

    const contentType = normalizeMimeType(response.headers.get("content-type"));
    if (contentType && !contentType.includes("html")) {
      const probe: DownloadProbeResult = {
        provider: "ig",
        status: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: response.url || permalink.normalizedUrl,
        reason: "unexpected_content_type",
        metadata: {
          mimeType: contentType
        }
      };
      logInstagramInfo(logger, "instagram_probe_kind", {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        probeKind: "unsupported",
        reason: probe.reason,
        mimeType: contentType
      }, "instagram probe kind resolved");
      return { probe };
    }

    const htmlContentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(htmlContentLength) && htmlContentLength > maxHtmlBytes) {
      const probe: DownloadProbeResult = {
        provider: "ig",
        status: "error",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: response.url || permalink.normalizedUrl,
        reason: "html_payload_too_large"
      };
      logInstagramWarn(logger, "instagram_probe_kind", {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        probeKind: "error",
        reason: probe.reason,
        htmlContentLength
      }, "instagram probe failed");
      return { probe };
    }

    const html = await response.text();
    if (Buffer.byteLength(html, "utf-8") > maxHtmlBytes) {
      const probe: DownloadProbeResult = {
        provider: "ig",
        status: "error",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: response.url || permalink.normalizedUrl,
        reason: "html_payload_too_large"
      };
      logInstagramWarn(logger, "instagram_probe_kind", {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl: probe.canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        probeKind: "error",
        reason: probe.reason
      }, "instagram probe failed");
      return { probe };
    }

    const ogVideo =
      extractMetaContent(html, "og:video:secure_url") ??
      extractMetaContent(html, "og:video:url") ??
      extractMetaContent(html, "og:video");
    const ogImage = extractMetaContent(html, "og:image:secure_url") ?? extractMetaContent(html, "og:image");
    const ogUrl = extractMetaContent(html, "og:url");
    const ogTitle = extractMetaContent(html, "og:title");
    const ogDescription = extractMetaContent(html, "og:description");
    const canonicalUrl = ogUrl ?? response.url ?? permalink.normalizedUrl;

    const videoCandidates = collectVideoCandidates({
      html,
      canonicalUrl,
      ogVideo: ogVideo ?? undefined
    });
    const imageCandidates = collectImageCandidates({
      html,
      canonicalUrl,
      ogImage: ogImage ?? undefined
    });

    const resolvedTitle = (ogTitle ?? ogDescription ?? extractTitleFromHtml(html))?.replace(/\s+/g, " ").trim();
    const itemCount = extractCarouselCount(html);
    const probeKind = resolveProbeKind({
      permalinkKind: permalink.kind,
      videoCandidates,
      imageCandidates
    });

    if (!probeKind) {
      if (containsPrivateMarkers(html)) {
        const probe: DownloadProbeResult = {
          provider: "ig",
          status: "blocked",
          sourceUrl: permalink.sourceUrl,
          canonicalUrl,
          reason: "private_or_login_required"
        };
        logInstagramInfo(logger, "instagram_probe_kind", {
          sourceUrl: permalink.sourceUrl,
          canonicalUrl,
          pathKind: permalink.kind,
          probeStatus: probe.status,
          probeKind: "blocked",
          reason: probe.reason
        }, "instagram probe kind resolved");
        return { probe };
      }
      if (containsUnavailableMarkers(html)) {
        const probe: DownloadProbeResult = {
          provider: "ig",
          status: "invalid",
          sourceUrl: permalink.sourceUrl,
          canonicalUrl,
          reason: "content_unavailable"
        };
        logInstagramInfo(logger, "instagram_probe_kind", {
          sourceUrl: permalink.sourceUrl,
          canonicalUrl,
          pathKind: permalink.kind,
          probeStatus: probe.status,
          probeKind: "invalid",
          reason: probe.reason
        }, "instagram probe kind resolved");
        return { probe };
      }

      const probe: DownloadProbeResult = {
        provider: "ig",
        status: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl,
        reason: "media_not_resolved"
      };
      logInstagramInfo(logger, "instagram_probe_kind", {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        probeKind: "unsupported",
        reason: probe.reason,
        videoCandidates: videoCandidates.length,
        imageCandidates: imageCandidates.length
      }, "instagram probe kind resolved");
      return { probe };
    }

    if (probeKind === "preview_only") {
      const probe: DownloadProbeResult = {
        provider: "ig",
        status: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl,
        title: resolvedTitle || undefined,
        reason: "preview_only",
        metadata: {
          mimeType: "image/jpeg"
        }
      };
      logInstagramInfo(logger, "instagram_probe_kind", {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        probeKind,
        reason: probe.reason,
        videoCandidates: videoCandidates.length,
        imageCandidates: imageCandidates.length
      }, "instagram probe kind resolved");
      return { probe };
    }

    const expectedMediaKind: InstagramMediaKind = probeKind === "image_post" ? "image" : "video";
    const mediaCandidates = expectedMediaKind === "video" ? videoCandidates : imageCandidates;
    if (mediaCandidates.length === 0) {
      const probe: DownloadProbeResult = {
        provider: "ig",
        status: "unsupported",
        sourceUrl: permalink.sourceUrl,
        canonicalUrl,
        title: resolvedTitle || undefined,
        reason: "media_not_resolved"
      };
      logInstagramInfo(logger, "instagram_probe_kind", {
        sourceUrl: permalink.sourceUrl,
        canonicalUrl,
        pathKind: permalink.kind,
        probeStatus: probe.status,
        probeKind: "unsupported",
        reason: probe.reason
      }, "instagram probe kind resolved");
      return { probe };
    }

    const page: InstagramResolvedPage = {
      sourceUrl: permalink.sourceUrl,
      canonicalUrl,
      permalinkUrl: permalink.normalizedUrl,
      shortcode: permalink.shortcode,
      kind: permalink.kind,
      probeKind,
      expectedMediaKind,
      mediaCandidates,
      title: resolvedTitle || undefined,
      thumbnailUrl: imageCandidates[0] ?? undefined,
      itemCount
    };

    writeProbeCache(permalink.normalizedUrl, page);
    writeProbeCache(canonicalUrl, page);

    const probe: DownloadProbeResult = {
      provider: "ig",
      status: "ready",
      sourceUrl: permalink.sourceUrl,
      canonicalUrl,
      title: page.title,
      reason: resolveProbeReason({ probeKind: page.probeKind, itemCount: page.itemCount }),
      metadata: {
        mimeType: page.expectedMediaKind === "video" ? "video/mp4" : "image/jpeg"
      }
    };

    logInstagramInfo(logger, "instagram_probe_kind", {
      sourceUrl: permalink.sourceUrl,
      canonicalUrl,
      pathKind: permalink.kind,
      probeStatus: probe.status,
      probeKind: page.probeKind,
      reason: probe.reason,
      mediaCandidates: page.mediaCandidates.length,
      itemCount: page.itemCount
    }, "instagram probe kind resolved");

    return { probe, page };
  };

  const resolveAsset = async (inputValue: {
    page: InstagramResolvedPage;
    request: DownloadProviderDownloadInput;
  }): Promise<
    | { ok: true; asset: InstagramResolvedAssetCandidate }
    | { ok: false; status: DownloadExecutionResult["status"]; reason: string }
  > => {
    const effectiveMaxBytes = inputValue.request.maxBytes ?? maxBytes;
    const candidateUrl = inputValue.page.mediaCandidates[0];

    if (!candidateUrl) {
      if (inputValue.page.probeKind === "preview_only") {
        logInstagramInfo(logger, "instagram_asset_resolve_preview_only", {
          sourceUrl: inputValue.page.sourceUrl,
          canonicalUrl: inputValue.page.canonicalUrl,
          probeKind: inputValue.page.probeKind,
          reason: "preview_only"
        }, "instagram asset resolve preview only");
        return {
          ok: false,
          status: "unsupported",
          reason: "preview_only"
        };
      }
      return {
        ok: false,
        status: "unsupported",
        reason: "asset_not_resolved"
      };
    }

    logInstagramInfo(logger, "instagram_asset_resolve_started", {
      sourceUrl: inputValue.page.sourceUrl,
      canonicalUrl: inputValue.page.canonicalUrl,
      probeKind: inputValue.page.probeKind,
      assetUrlPreview: candidateUrl.slice(0, 220)
    }, "instagram asset resolve started");

    const timeout = withTimeoutSignal(timeoutMs);
    let headResponse: Response | null = null;
    try {
      headResponse = await fetchImpl(candidateUrl, {
        method: "HEAD",
        redirect: "follow",
        signal: timeout.signal,
        headers: buildHeaders(userAgent, "*/*")
      });
    } catch {
      headResponse = null;
    } finally {
      timeout.clear();
    }

    if (headResponse && !headResponse.ok && headResponse.status !== 405) {
      const status = resolveProbeStatusFromResponse(headResponse.status);
      const reason = `asset_head_http_${headResponse.status}`;
      logInstagramWarn(logger, "instagram_asset_resolve_preview_only", {
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        probeKind: inputValue.page.probeKind,
        reason,
        httpStatus: headResponse.status
      }, "instagram asset resolve failed");
      return {
        ok: false,
        status,
        reason
      };
    }

    const mimeTypeHint = normalizeMimeType(headResponse?.headers.get("content-type"));
    const rawLength = Number(headResponse?.headers.get("content-length") ?? "0");
    const sizeBytesHint = Number.isFinite(rawLength) && rawLength > 0 ? rawLength : undefined;

    if (sizeBytesHint && sizeBytesHint > effectiveMaxBytes) {
      return {
        ok: false,
        status: "blocked",
        reason: "max_bytes_exceeded"
      };
    }

    if (mimeTypeHint && !isMimeCompatible(mimeTypeHint, inputValue.page.expectedMediaKind)) {
      if (inputValue.page.expectedMediaKind === "video" && mimeTypeHint.startsWith("image/")) {
        logInstagramInfo(logger, "instagram_asset_resolve_preview_only", {
          sourceUrl: inputValue.page.sourceUrl,
          canonicalUrl: inputValue.page.canonicalUrl,
          probeKind: inputValue.page.probeKind,
          mimeTypeHint,
          reason: "preview_only"
        }, "instagram asset resolve preview only");
        return {
          ok: false,
          status: "unsupported",
          reason: "preview_only"
        };
      }
      return {
        ok: false,
        status: "unsupported",
        reason: "unexpected_media_content_type"
      };
    }

    const resolvedAsset: InstagramResolvedAssetCandidate = {
      kind: inputValue.page.expectedMediaKind,
      url: headResponse?.url || candidateUrl,
      probeKind: inputValue.page.probeKind,
      mimeTypeHint: mimeTypeHint || undefined,
      sizeBytesHint
    };

    logInstagramInfo(logger, "instagram_asset_resolve_success", {
      sourceUrl: inputValue.page.sourceUrl,
      canonicalUrl: inputValue.page.canonicalUrl,
      probeKind: inputValue.page.probeKind,
      resolvedAssetKind: resolvedAsset.kind,
      mimeTypeHint: resolvedAsset.mimeTypeHint,
      sizeBytesHint: resolvedAsset.sizeBytesHint,
      assetUrlPreview: resolvedAsset.url.slice(0, 220)
    }, "instagram asset resolve success");

    return {
      ok: true,
      asset: resolvedAsset
    };
  };

  const downloadResolvedAsset = async (inputValue: {
    page: InstagramResolvedPage;
    asset: InstagramResolvedAssetCandidate;
    request: DownloadProviderDownloadInput;
  }): Promise<DownloadExecutionResult> => {
    const effectiveMaxBytes = inputValue.request.maxBytes ?? maxBytes;
    if (inputValue.asset.sizeBytesHint && inputValue.asset.sizeBytesHint > effectiveMaxBytes) {
      return {
        provider: "ig",
        status: "blocked",
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        title: inputValue.page.title,
        reason: "max_bytes_exceeded",
        assets: []
      };
    }

    logInstagramInfo(logger, "instagram_download_started", {
      sourceUrl: inputValue.page.sourceUrl,
      canonicalUrl: inputValue.page.canonicalUrl,
      probeKind: inputValue.page.probeKind,
      assetKind: inputValue.asset.kind,
      assetUrlPreview: inputValue.asset.url.slice(0, 220)
    }, "instagram download started");

    const timeout = withTimeoutSignal(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(inputValue.asset.url, {
        method: "GET",
        redirect: "follow",
        signal: timeout.signal,
        headers: buildHeaders(userAgent, "*/*")
      });
    } catch (error) {
      timeout.clear();
      const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      logInstagramWarn(logger, "instagram_download_failed", {
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        probeKind: inputValue.page.probeKind,
        assetKind: inputValue.asset.kind,
        reason
      }, "instagram download failed");
      return {
        provider: "ig",
        status: "error",
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        title: inputValue.page.title,
        reason,
        assets: []
      };
    } finally {
      timeout.clear();
    }

    if (!response.ok) {
      const status = resolveProbeStatusFromResponse(response.status);
      const reason = `media_http_${response.status}`;
      logInstagramWarn(logger, "instagram_download_failed", {
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        probeKind: inputValue.page.probeKind,
        assetKind: inputValue.asset.kind,
        reason,
        httpStatus: response.status
      }, "instagram download failed");
      return {
        provider: "ig",
        status,
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        title: inputValue.page.title,
        reason,
        assets: []
      };
    }

    const contentType = normalizeMimeType(response.headers.get("content-type"));
    if (contentType && !isMimeCompatible(contentType, inputValue.asset.kind)) {
      const reason = inputValue.asset.kind === "video" && contentType.startsWith("image/") ? "preview_only" : "unexpected_media_content_type";
      logInstagramInfo(logger, "instagram_download_failed", {
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        probeKind: inputValue.page.probeKind,
        assetKind: inputValue.asset.kind,
        reason,
        mimeType: contentType
      }, "instagram download failed");
      return {
        provider: "ig",
        status: "unsupported",
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        title: inputValue.page.title,
        reason,
        assets: []
      };
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > effectiveMaxBytes) {
      logInstagramInfo(logger, "instagram_download_failed", {
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        probeKind: inputValue.page.probeKind,
        assetKind: inputValue.asset.kind,
        reason: "max_bytes_exceeded",
        byteLength: contentLength
      }, "instagram download failed");
      return {
        provider: "ig",
        status: "blocked",
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        title: inputValue.page.title,
        reason: "max_bytes_exceeded",
        assets: []
      };
    }

    let mediaBuffer: Buffer;
    try {
      mediaBuffer = await readResponseBufferWithinLimit(response, effectiveMaxBytes);
    } catch (error) {
      const reason = error instanceof MaxBytesExceededError ? "max_bytes_exceeded" : "media_download_failed";
      const status: DownloadExecutionResult["status"] = error instanceof MaxBytesExceededError ? "blocked" : "error";
      logInstagramWarn(logger, "instagram_download_failed", {
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        probeKind: inputValue.page.probeKind,
        assetKind: inputValue.asset.kind,
        reason
      }, "instagram download failed");
      return {
        provider: "ig",
        status,
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        title: inputValue.page.title,
        reason,
        assets: []
      };
    }

    let finalMimeType = contentType || inputValue.asset.mimeTypeHint || "application/octet-stream";
    if (inputValue.asset.kind === "video") {
      const normalizedVideo = normalizeVideoForWhatsapp({
        mimeType: finalMimeType,
        mediaBuffer
      });
      if (!normalizedVideo.ok) {
        logInstagramInfo(logger, "instagram_download_failed", {
          sourceUrl: inputValue.page.sourceUrl,
          canonicalUrl: inputValue.page.canonicalUrl,
          probeKind: inputValue.page.probeKind,
          assetKind: inputValue.asset.kind,
          reason: normalizedVideo.reason,
          mimeType: finalMimeType
        }, "instagram download failed");
        return {
          provider: "ig",
          status: "unsupported",
          sourceUrl: inputValue.page.sourceUrl,
          canonicalUrl: inputValue.page.canonicalUrl,
          title: inputValue.page.title,
          reason: normalizedVideo.reason,
          assets: []
        };
      }
      finalMimeType = normalizedVideo.mimeType;
    } else {
      const inferredImageMime = contentType || inferImageMimeFromSignature(mediaBuffer);
      if (inferredImageMime) {
        finalMimeType = inferredImageMime;
      }
      if (!finalMimeType.startsWith("image/")) {
        return {
          provider: "ig",
          status: "unsupported",
          sourceUrl: inputValue.page.sourceUrl,
          canonicalUrl: inputValue.page.canonicalUrl,
          title: inputValue.page.title,
          reason: "unexpected_media_content_type",
          assets: []
        };
      }
    }

    const fileNameBase = inputValue.page.shortcode ? `ig-${inputValue.page.shortcode}` : "instagram-media";
    const extension = resolveExtensionFromMimeType(finalMimeType);
    const reason = inputValue.page.itemCount && inputValue.page.itemCount > 1 ? "carousel_first_item_only" : "download_ready";

    logInstagramInfo(logger, "instagram_download_success", {
      sourceUrl: inputValue.page.sourceUrl,
      canonicalUrl: inputValue.page.canonicalUrl,
      probeKind: inputValue.page.probeKind,
      assetKind: inputValue.asset.kind,
      mimeType: finalMimeType,
      byteLength: mediaBuffer.length,
      reason
    }, "instagram download success");

    return {
      provider: "ig",
      status: "ready",
      sourceUrl: inputValue.page.sourceUrl,
      canonicalUrl: inputValue.page.canonicalUrl,
      title: inputValue.page.title,
      reason,
      assets: [
        {
          kind: inputValue.asset.kind,
          mimeType: finalMimeType,
          fileName: `${fileNameBase}.${extension}`,
          sizeBytes: mediaBuffer.length,
          thumbnailUrl: inputValue.page.thumbnailUrl,
          directUrl: response.url || inputValue.asset.url,
          bufferBase64: mediaBuffer.toString("base64")
        }
      ]
    };
  };

  const executeDownloadFromPage = async (inputValue: {
    page: InstagramResolvedPage;
    request: DownloadProviderDownloadInput;
  }): Promise<DownloadExecutionResult> => {
    const resolvedAsset = await resolveAsset({
      page: inputValue.page,
      request: inputValue.request
    });
    if (!resolvedAsset.ok) {
      return {
        provider: "ig",
        status: resolvedAsset.status,
        sourceUrl: inputValue.page.sourceUrl,
        canonicalUrl: inputValue.page.canonicalUrl,
        title: inputValue.page.title,
        reason: resolvedAsset.reason,
        assets: []
      };
    }

    return downloadResolvedAsset({
      page: inputValue.page,
      asset: resolvedAsset.asset,
      request: inputValue.request
    });
  };

  return {
    provider: "ig",
    detect: (inputValue): DownloadProviderDetection | null => {
      const permalink = parseInstagramPermalink(inputValue.url);
      if (!permalink) return null;
      const confidence = permalink.kind === "unknown" ? 0.6 : 0.99;
      const reason =
        permalink.kind === "post"
          ? "instagram_post"
          : permalink.kind === "reel"
            ? "instagram_reel"
            : permalink.kind === "tv"
              ? "instagram_tv"
              : "instagram_unknown_path";
      return {
        provider: "ig",
        family: "instagram",
        normalizedUrl: permalink.normalizedUrl,
        confidence,
        reason
      };
    },
    probe: async (request) => {
      const resolved = await resolveInstagramProbe(request);
      return resolved.probe;
    },
    downloadWithProbe: async (payload) => {
      if (payload.probe.status !== "ready") return mapProbeToExecution(payload.probe);
      const cacheKey = payload.probe.canonicalUrl ?? payload.request.url;
      const cached = readProbeCache(cacheKey) ?? readProbeCache(payload.request.url);
      if (cached) {
        return executeDownloadFromPage({
          page: cached,
          request: payload.request
        });
      }

      const resolved = await resolveInstagramProbe(payload.request);
      if (!resolved.page || resolved.probe.status !== "ready") return mapProbeToExecution(resolved.probe);
      return executeDownloadFromPage({
        page: resolved.page,
        request: payload.request
      });
    },
    download: async (request): Promise<DownloadExecutionResult> => {
      const resolved = await resolveInstagramProbe(request);
      if (!resolved.page || resolved.probe.status !== "ready") return mapProbeToExecution(resolved.probe);
      return executeDownloadFromPage({
        page: resolved.page,
        request
      });
    }
  };
};
