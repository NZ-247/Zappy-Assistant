import type { ImageSearchPort, ImageSearchResultItem, LoggerPort } from "@zappy/core";
import {
  clampInt,
  createGoogleCseImageProvider,
  createOpenverseImageProvider,
  createPexelsImageProvider,
  createPixabayImageProvider,
  createUnsplashImageProvider,
  createWikimediaImageProvider,
  normalizeOptional,
  resolveGoogleEngineId,
  type FetchLike,
  type ImageProviderAdapter,
  type ImageProviderSource
} from "./image-providers/index.js";
import { inferMimeTypeFromUrl } from "./image-providers/common.js";

export type ImageSearchPreferredProvider = "native" | "wikimedia" | "openverse" | "pixabay" | "pexels" | "unsplash" | "google";

export interface ImageSearchAdapterInput {
  googleApiKey?: string;
  googleSearchEngineId?: string;
  googleCx?: string;
  openverseApiBaseUrl?: string;
  pixabayApiKey?: string;
  pexelsApiKey?: string;
  unsplashAccessKey?: string;
  timeoutMs?: number;
  preferredProvider?: ImageSearchPreferredProvider;
  logger?: LoggerPort;
  fetchImpl?: FetchLike;
  mediaValidationTimeoutMs?: number;
  mediaValidationMaxBytes?: number;
  mediaValidationMinBytes?: number;
  mediaValidationCandidates?: number;
  mediaNormalizationEnabled?: boolean;
  mediaNormalizationMaxDimension?: number;
  mediaNormalizationJpegQuality?: number;
  mediaNormalizationTriggerBytes?: number;
  variabilityPoolSize?: number;
  maxValidatedDeliverables?: number;
  recentDeliveryTtlMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MEDIA_VALIDATION_TIMEOUT_MS = 8_000;
const DEFAULT_MEDIA_VALIDATION_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MEDIA_VALIDATION_MIN_BYTES = 512;
const DEFAULT_MEDIA_VALIDATION_CANDIDATES = 6;
const DEFAULT_MEDIA_NORMALIZATION_ENABLED = true;
const DEFAULT_MEDIA_NORMALIZATION_MAX_DIMENSION = 2_048;
const DEFAULT_MEDIA_NORMALIZATION_JPEG_QUALITY = 86;
const DEFAULT_MEDIA_NORMALIZATION_TRIGGER_BYTES = 2 * 1024 * 1024;
const DEFAULT_VARIABILITY_POOL_SIZE = 4;
const DEFAULT_MAX_VALIDATED_DELIVERABLES = 4;
const DEFAULT_RECENT_DELIVERY_TTL_MS = 10 * 60 * 1000;

const STOPWORDS = new Set([
  "a",
  "o",
  "as",
  "os",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "para",
  "por",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for"
]);

const SOURCE_RELIABILITY: Record<string, number> = {
  wikimedia: 1,
  openverse: 0.96,
  pixabay: 0.92,
  pexels: 0.9,
  unsplash: 0.88,
  google_cse: 0.54
};

const EXCLUDED_DOMAIN_PATTERNS = [
  /(^|\.)pinterest\./i,
  /(^|\.)pinimg\./i,
  /(^|\.)behance\.net$/i,
  /(^|\.)dribbble\.com$/i,
  /(^|\.)artstation\.com$/i,
  /(^|\.)deviantart\.com$/i,
  /(^|\.)wixmp\.com$/i
];

const SOURCE_DOMAIN_BONUS: Array<{ source: string; pattern: RegExp; score: number }> = [
  { source: "wikimedia", pattern: /(^|\.)wikimedia\.org$/i, score: 1.2 },
  { source: "openverse", pattern: /(^|\.)openverse\.org$/i, score: 1 },
  { source: "pixabay", pattern: /(^|\.)pixabay\.com$/i, score: 0.95 },
  { source: "pexels", pattern: /(^|\.)pexels\.com$/i, score: 0.9 },
  { source: "unsplash", pattern: /(^|\.)unsplash\.com$/i, score: 0.88 },
  { source: "google_cse", pattern: /(^|\.)google\./i, score: 0.45 }
];

const NATIVE_PROVIDER_ORDER: ImageProviderSource[] = ["wikimedia", "openverse", "pixabay", "pexels", "unsplash"];

type CandidateDiagnostic = {
  source?: string;
  title: string;
  link: string;
  pageUrl?: string;
  imageUrl: string;
  candidateIndex: number;
  status: "accepted" | "rejected";
  reason: string;
  httpStatus?: number;
  mimeType?: string;
  byteLength?: number;
};

type NormalizedImageCandidate = ImageSearchResultItem & {
  source: string;
  title: string;
  link: string;
  pageUrl: string;
  imageUrl: string;
};

type ValidatedDeliverableCandidate = {
  source: string;
  title: string;
  link: string;
  pageUrl?: string;
  imageUrl: string;
  thumbnailUrl?: string;
  imageBase64: string;
  mimeType: string;
  attribution?: string;
  providerConfidence?: number;
  licenseInfo?: {
    code?: string;
    name?: string;
    version?: string;
    url?: string;
    requiresAttribution?: boolean;
  };
  byteLength: number;
  candidateIndex: number;
};

type ValidatedCandidatePool = {
  deliverableCandidates: ValidatedDeliverableCandidate[];
  candidateDiagnostics: CandidateDiagnostic[];
  triedImageKeys: Set<string>;
};

const shorten = (value: string, max = 180): string => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);

const normalizePreferredProvider = (value?: string): ImageSearchPreferredProvider => {
  const normalized = normalizeOptional(value)?.toLowerCase();
  if (!normalized) return "native";
  if (["native", "wikimedia", "openverse", "pixabay", "pexels", "unsplash", "google"].includes(normalized)) {
    return normalized as ImageSearchPreferredProvider;
  }
  return "native";
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

const countTokenMatches = (tokens: string[], text: string): number => {
  if (!tokens.length || !text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) score += 1;
  }
  return score;
};

const isFilenameLikeTitle = (value?: string): boolean => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (/^[^ ]+\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|tiff?)$/i.test(lower)) return true;
  if (lower.startsWith("file:") || lower.startsWith("img_") || lower.startsWith("dsc_")) return true;

  const compact = normalized.replace(/[\s_-]+/g, "");
  if (compact.length >= 14 && /^[a-z0-9]+$/i.test(compact) && (/\d{5,}/.test(compact) || /^[a-f0-9]{14,}$/i.test(compact))) {
    return true;
  }

  return false;
};

const normalizeMimeType = (value?: string | null): string => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  const main = normalized.split(";")[0]?.trim() ?? "";
  return main === "image/jpg" ? "image/jpeg" : main;
};

const getHost = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const isExcludedDomain = (value?: string): boolean => {
  const host = getHost(value);
  if (!host) return false;
  return EXCLUDED_DOMAIN_PATTERNS.some((pattern) => pattern.test(host));
};

const canonicalImageUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
};

const normalizeCandidate = (item: ImageSearchResultItem): NormalizedImageCandidate | null => {
  const imageUrl = normalizeOptional(item.imageUrl);
  if (!imageUrl) return null;

  const pageUrl = normalizeOptional(item.pageUrl) ?? normalizeOptional(item.link) ?? imageUrl;
  if (!pageUrl) return null;

  if (isExcludedDomain(imageUrl) || isExcludedDomain(pageUrl)) return null;

  const source = normalizeOptional(item.source) ?? "unknown";
  const title = normalizeOptional(item.title) ?? "Imagem";
  const mimeType = normalizeOptional(item.mimeType) ?? inferMimeTypeFromUrl(imageUrl);
  const attribution = normalizeOptional(item.attribution);
  const providerConfidenceRaw = Number(item.providerConfidence);
  const providerConfidence = Number.isFinite(providerConfidenceRaw) ? Math.min(1, Math.max(0, providerConfidenceRaw)) : undefined;

  return {
    ...item,
    source,
    title,
    pageUrl,
    link: pageUrl,
    imageUrl,
    thumbnailUrl: normalizeOptional(item.thumbnailUrl),
    mimeType,
    attribution,
    providerConfidence
  };
};

const imageExtensionScore = (url: string, mimeType?: string): number => {
  const normalizedMime = normalizeMimeType(mimeType);
  const lower = url.toLowerCase();

  if (normalizedMime === "image/svg+xml" || lower.endsWith(".svg") || lower.includes("format=svg")) return -6;
  if (normalizedMime === "image/gif" || lower.endsWith(".gif") || lower.includes("format=gif")) return -1.5;
  if (normalizedMime === "image/jpeg" || normalizedMime === "image/png") return 1.2;
  if (normalizedMime === "image/webp") return 0.8;
  if (["image/heic", "image/heif", "image/avif", "image/tiff", "image/bmp"].includes(normalizedMime)) return 0.4;

  if (/\.(jpe?g|png)(?:$|[?#])/i.test(lower)) return 1;
  if (/\.(webp)(?:$|[?#])/i.test(lower)) return 0.7;
  if (/\.(avif|heic|heif|tiff?|bmp)(?:$|[?#])/i.test(lower)) return 0.3;

  return 0;
};

const sourceDomainScore = (source: string, pageUrl: string, imageUrl: string): number => {
  const pageHost = getHost(pageUrl);
  const imageHost = getHost(imageUrl);
  let score = 0;

  if (pageHost) {
    for (const entry of SOURCE_DOMAIN_BONUS) {
      if (entry.source === source && entry.pattern.test(pageHost)) {
        score = Math.max(score, entry.score);
      }
    }
  }

  if (imageHost) {
    for (const entry of SOURCE_DOMAIN_BONUS) {
      if (entry.source === source && entry.pattern.test(imageHost)) {
        score = Math.max(score, entry.score);
      }
    }
  }

  return score;
};

const rankAndFilterImageResults = (input: { query: string; items: ImageSearchResultItem[]; limit: number }): NormalizedImageCandidate[] => {
  const query = input.query.trim().toLowerCase();
  const tokens = tokenize(query);
  const seenImageUrls = new Set<string>();

  const scored = input.items
    .map((item) => {
      const normalized = normalizeCandidate(item);
      if (!normalized) return null;

      const key = canonicalImageUrl(normalized.imageUrl);
      if (seenImageUrls.has(key)) return null;
      seenImageUrls.add(key);

      const titleMatches = countTokenMatches(tokens, normalized.title);
      const imageMatches = countTokenMatches(tokens, normalized.imageUrl);
      const pageMatches = countTokenMatches(tokens, normalized.pageUrl);
      const fullQueryHit =
        query.length >= 4 &&
        (normalized.title.toLowerCase().includes(query) || normalized.pageUrl.toLowerCase().includes(query) || normalized.imageUrl.toLowerCase().includes(query));

      const sourceReliability = SOURCE_RELIABILITY[normalized.source] ?? 0.5;
      const providerConfidence = normalized.providerConfidence ?? sourceReliability;
      const domainScore = sourceDomainScore(normalized.source, normalized.pageUrl, normalized.imageUrl);
      const extensionScore = imageExtensionScore(normalized.imageUrl, normalized.mimeType);
      const titleCoverage = tokens.length > 0 ? titleMatches / tokens.length : 0;
      const pageCoverage = tokens.length > 0 ? pageMatches / tokens.length : 0;
      const titlePhraseHit = query.length >= 4 && normalized.title.toLowerCase().includes(query);
      const titleLooksFilename = isFilenameLikeTitle(normalized.title);

      let score = 0;
      score += fullQueryHit ? 7 : 0;
      score += titleMatches * 3.1;
      score += pageMatches * 1.8;
      score += imageMatches * 1.2;
      score += titleCoverage * 2.2;
      score += pageCoverage * 0.9;
      score += titlePhraseHit ? 1.4 : 0;
      score += sourceReliability * 3.3;
      score += providerConfidence * 2.7;
      score += domainScore * 1.9;
      score += extensionScore;
      if (normalized.title.length < 6) score -= 0.8;
      if (titleLooksFilename) score -= 2.8;
      if ((normalized.thumbnailUrl ?? "").toLowerCase().includes("thumb")) score -= 0.2;

      return {
        item: normalized,
        score,
        relevance: titleMatches + pageMatches + imageMatches
      };
    })
    .filter((entry): entry is { item: NormalizedImageCandidate; score: number; relevance: number } => Boolean(entry));

  const filtered = scored.filter((entry) => (tokens.length === 0 ? true : entry.relevance > 0));
  const pool = filtered.length > 0 ? filtered : scored;

  return pool
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((entry) => entry.item);
};

const hasLikelyImageSignature = (bytes: Buffer): boolean => {
  if (bytes.length < 4) return false;

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
    return true;
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;

  const gifSig = bytes.subarray(0, 6).toString("ascii");
  if (gifSig === "GIF87a" || gifSig === "GIF89a") return true;

  const riffSig = bytes.subarray(0, 4).toString("ascii");
  const webpSig = bytes.length >= 12 ? bytes.subarray(8, 12).toString("ascii") : "";
  if (riffSig === "RIFF" && webpSig === "WEBP") return true;

  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return true;

  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return true;
  }

  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii").toLowerCase();
    if (["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return true;
  }

  return false;
};

const looksLikeHtmlPayload = (bytes: Buffer): boolean => {
  if (!bytes.length) return false;
  const probe = bytes.subarray(0, Math.min(256, bytes.length)).toString("utf-8").trimStart().toLowerCase();
  return probe.startsWith("<!doctype html") || probe.startsWith("<html") || probe.startsWith("<?xml");
};

const looksBinaryEnough = (bytes: Buffer): boolean => {
  const sample = bytes.subarray(0, Math.min(96, bytes.length));
  let nonAscii = 0;
  for (const value of sample) {
    if (value === 0 || value > 0x7f) nonAscii += 1;
  }
  return nonAscii >= 2;
};

const logMediaValidation = (
  logger: LoggerPort | undefined,
  payload: {
    status: "started" | "success" | "rejected" | "failure";
    query: string;
    provider?: string;
    source?: string;
    candidateIndex: number;
    imageUrl: string;
    reason?: string;
    httpStatus?: number;
    mimeType?: string;
    byteLength?: number;
    elapsedMs?: number;
  }
) => {
  logger?.info?.(
    {
      capability: "image-search-media",
      action: "candidate_validation",
      status: payload.status,
      queryPreview: shorten(payload.query, 120),
      provider: payload.provider,
      source: payload.source,
      candidateIndex: payload.candidateIndex,
      imageUrlPreview: shorten(payload.imageUrl, 180),
      reason: payload.reason,
      httpStatus: payload.httpStatus,
      mimeType: payload.mimeType,
      byteLength: payload.byteLength,
      elapsedMs: payload.elapsedMs
    },
    payload.status === "started"
      ? "media download started"
      : payload.status === "success"
        ? "media download success"
        : payload.status === "rejected"
          ? "media candidate rejected"
          : "media download failure"
  );
};

const downloadCandidateImage = async (input: {
  imageUrl: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxBytes: number;
  minBytes: number;
}): Promise<
  | { ok: true; buffer: Buffer; mimeType: string; byteLength: number; httpStatus: number }
  | { ok: false; reason: string; httpStatus?: number; mimeType?: string; byteLength?: number }
> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await input.fetchImpl(input.imageUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "zappy-assistant/1.6 (+image-search-delivery)"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: `http_${response.status}`,
        httpStatus: response.status
      };
    }

    const mimeType = normalizeMimeType(response.headers.get("content-type"));
    if (!mimeType || !mimeType.startsWith("image/")) {
      return {
        ok: false,
        reason: "invalid_content_type",
        mimeType
      };
    }

    if (mimeType === "image/svg+xml") {
      return {
        ok: false,
        reason: "unsupported_svg",
        mimeType
      };
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
      return {
        ok: false,
        reason: "payload_too_large",
        mimeType,
        byteLength: contentLength
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      return {
        ok: false,
        reason: "empty_body",
        mimeType,
        byteLength: 0
      };
    }

    if (bytes.length < input.minBytes) {
      return {
        ok: false,
        reason: "body_too_small",
        mimeType,
        byteLength: bytes.length
      };
    }

    if (bytes.length > input.maxBytes) {
      return {
        ok: false,
        reason: "payload_too_large",
        mimeType,
        byteLength: bytes.length
      };
    }

    if (looksLikeHtmlPayload(bytes)) {
      return {
        ok: false,
        reason: "suspicious_html_body",
        mimeType,
        byteLength: bytes.length
      };
    }

    const knownSignature = hasLikelyImageSignature(bytes);
    if (!knownSignature && (!looksBinaryEnough(bytes) || /^image\/(png|jpeg|jpg|webp|gif|bmp|tiff|avif|heic|heif)$/i.test(mimeType))) {
      return {
        ok: false,
        reason: "invalid_image_signature",
        mimeType,
        byteLength: bytes.length
      };
    }

    return {
      ok: true,
      buffer: bytes,
      mimeType,
      byteLength: bytes.length,
      httpStatus: response.status
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: isAbort ? "timeout" : "network_error"
    };
  } finally {
    clearTimeout(timer);
  }
};

let sharpLoader: Promise<((input: Buffer | Uint8Array) => any) | null> | null = null;
const loadSharp = async (): Promise<((input: Buffer | Uint8Array) => any) | null> => {
  if (!sharpLoader) {
    sharpLoader = import("sharp")
      .then((module) => module.default)
      .catch(() => null);
  }
  return sharpLoader;
};

const normalizeImageForDelivery = async (input: {
  buffer: Buffer;
  mimeType: string;
  maxBytes: number;
  config: {
    enabled: boolean;
    maxDimension: number;
    jpegQuality: number;
    triggerBytes: number;
  };
}): Promise<{ buffer: Buffer; mimeType: string; byteLength: number; normalized: boolean }> => {
  const normalizedMime = normalizeMimeType(input.mimeType);
  const mustNormalize =
    input.config.enabled &&
    (!normalizedMime ||
      !["image/jpeg", "image/png"].includes(normalizedMime) ||
      input.buffer.length > input.config.triggerBytes ||
      /^image\/(heic|heif|avif|tiff|bmp|gif|webp)$/i.test(normalizedMime));

  if (!mustNormalize) {
    return {
      buffer: input.buffer,
      mimeType: normalizedMime || "image/jpeg",
      byteLength: input.buffer.length,
      normalized: false
    };
  }

  const sharp = await loadSharp();
  if (!sharp) {
    return {
      buffer: input.buffer,
      mimeType: normalizedMime || "image/jpeg",
      byteLength: input.buffer.length,
      normalized: false
    };
  }

  try {
    const base = sharp(input.buffer).rotate();
    const metadata = await base.metadata();
    const hasAlpha = Boolean(metadata.hasAlpha);

    let transformed = sharp(input.buffer)
      .rotate()
      .resize({
        width: input.config.maxDimension,
        height: input.config.maxDimension,
        fit: "inside",
        withoutEnlargement: true
      });

    let output: Buffer;
    let outputMimeType: string;

    if (hasAlpha) {
      output = await transformed.png({ compressionLevel: 9 }).toBuffer();
      outputMimeType = "image/png";
    } else {
      output = await transformed.jpeg({ quality: input.config.jpegQuality, mozjpeg: true }).toBuffer();
      outputMimeType = "image/jpeg";

      if (output.length > input.maxBytes) {
        const smaller = Math.max(1_024, Math.trunc(input.config.maxDimension * 0.82));
        transformed = sharp(input.buffer)
          .rotate()
          .resize({
            width: smaller,
            height: smaller,
            fit: "inside",
            withoutEnlargement: true
          });
        output = await transformed.jpeg({ quality: Math.max(62, input.config.jpegQuality - 18), mozjpeg: true }).toBuffer();
      }
    }

    if (!output.length) {
      return {
        buffer: input.buffer,
        mimeType: normalizedMime || "image/jpeg",
        byteLength: input.buffer.length,
        normalized: false
      };
    }

    return {
      buffer: output,
      mimeType: outputMimeType,
      byteLength: output.length,
      normalized: true
    };
  } catch {
    return {
      buffer: input.buffer,
      mimeType: normalizedMime || "image/jpeg",
      byteLength: input.buffer.length,
      normalized: false
    };
  }
};

const validateCandidatePool = async (input: {
  query: string;
  provider?: string;
  items: NormalizedImageCandidate[];
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxBytes: number;
  minBytes: number;
  maxCandidates: number;
  logger?: LoggerPort;
  normalization: {
    enabled: boolean;
    maxDimension: number;
    jpegQuality: number;
    triggerBytes: number;
  };
  maxDeliverables: number;
  skipImageKeys?: Set<string>;
}): Promise<ValidatedCandidatePool> => {
  const diagnostics: CandidateDiagnostic[] = [];
  const candidates = input.items.slice(0, input.maxCandidates);
  const triedImageKeys = new Set<string>();
  const deliverableCandidates: ValidatedDeliverableCandidate[] = [];
  const skipped = input.skipImageKeys ?? new Set<string>();

  let processedCandidates = 0;

  for (const candidate of candidates) {
    const imageUrl = candidate.imageUrl.trim();
    const key = canonicalImageUrl(imageUrl);
    if (skipped.has(key)) continue;
    if (triedImageKeys.has(key)) continue;

    triedImageKeys.add(key);
    processedCandidates += 1;
    const candidateIndex = processedCandidates;
    const startedAt = Date.now();

    logMediaValidation(input.logger, {
      status: "started",
      query: input.query,
      provider: input.provider,
      source: candidate.source,
      candidateIndex,
      imageUrl
    });

    const downloaded = await downloadCandidateImage({
      imageUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
      minBytes: input.minBytes
    });

    const elapsedMs = Date.now() - startedAt;

    if (!downloaded.ok) {
      diagnostics.push({
        source: candidate.source,
        title: candidate.title,
        link: candidate.link,
        pageUrl: candidate.pageUrl,
        imageUrl,
        candidateIndex,
        status: "rejected",
        reason: downloaded.reason,
        httpStatus: downloaded.httpStatus,
        mimeType: downloaded.mimeType,
        byteLength: downloaded.byteLength
      });

      logMediaValidation(input.logger, {
        status: downloaded.reason === "network_error" || downloaded.reason === "timeout" ? "failure" : "rejected",
        query: input.query,
        provider: input.provider,
        source: candidate.source,
        candidateIndex,
        imageUrl,
        reason: downloaded.reason,
        httpStatus: downloaded.httpStatus,
        mimeType: downloaded.mimeType,
        byteLength: downloaded.byteLength,
        elapsedMs
      });
      continue;
    }

    const normalized = await normalizeImageForDelivery({
      buffer: downloaded.buffer,
      mimeType: downloaded.mimeType,
      maxBytes: input.maxBytes,
      config: input.normalization
    });

    if (normalized.byteLength < input.minBytes) {
      diagnostics.push({
        source: candidate.source,
        title: candidate.title,
        link: candidate.link,
        pageUrl: candidate.pageUrl,
        imageUrl,
        candidateIndex,
        status: "rejected",
        reason: "normalized_body_too_small",
        httpStatus: downloaded.httpStatus,
        mimeType: normalized.mimeType,
        byteLength: normalized.byteLength
      });
      logMediaValidation(input.logger, {
        status: "rejected",
        query: input.query,
        provider: input.provider,
        source: candidate.source,
        candidateIndex,
        imageUrl,
        reason: "normalized_body_too_small",
        httpStatus: downloaded.httpStatus,
        mimeType: normalized.mimeType,
        byteLength: normalized.byteLength,
        elapsedMs
      });
      continue;
    }

    if (normalized.byteLength > input.maxBytes) {
      diagnostics.push({
        source: candidate.source,
        title: candidate.title,
        link: candidate.link,
        pageUrl: candidate.pageUrl,
        imageUrl,
        candidateIndex,
        status: "rejected",
        reason: "normalized_payload_too_large",
        httpStatus: downloaded.httpStatus,
        mimeType: normalized.mimeType,
        byteLength: normalized.byteLength
      });
      logMediaValidation(input.logger, {
        status: "rejected",
        query: input.query,
        provider: input.provider,
        source: candidate.source,
        candidateIndex,
        imageUrl,
        reason: "normalized_payload_too_large",
        httpStatus: downloaded.httpStatus,
        mimeType: normalized.mimeType,
        byteLength: normalized.byteLength,
        elapsedMs
      });
      continue;
    }

    const acceptanceReason = normalized.normalized ? "ok_normalized" : "ok";
    diagnostics.push({
      source: candidate.source,
      title: candidate.title,
      link: candidate.link,
      pageUrl: candidate.pageUrl,
      imageUrl,
      candidateIndex,
      status: "accepted",
      reason: acceptanceReason,
      httpStatus: downloaded.httpStatus,
      mimeType: normalized.mimeType,
      byteLength: normalized.byteLength
    });

    logMediaValidation(input.logger, {
      status: "success",
      query: input.query,
      provider: input.provider,
      source: candidate.source,
      candidateIndex,
      imageUrl,
      reason: acceptanceReason,
      httpStatus: downloaded.httpStatus,
      mimeType: normalized.mimeType,
      byteLength: normalized.byteLength,
      elapsedMs
    });

    deliverableCandidates.push({
      source: candidate.source,
      title: candidate.title,
      link: candidate.link,
      pageUrl: candidate.pageUrl,
      imageUrl,
      thumbnailUrl: candidate.thumbnailUrl,
      imageBase64: normalized.buffer.toString("base64"),
      mimeType: normalized.mimeType,
      attribution: candidate.attribution,
      providerConfidence: candidate.providerConfidence,
      licenseInfo: candidate.licenseInfo,
      byteLength: normalized.byteLength,
      candidateIndex
    });

    if (deliverableCandidates.length >= input.maxDeliverables) {
      break;
    }
  }

  return {
    deliverableCandidates,
    candidateDiagnostics: diagnostics,
    triedImageKeys
  };
};

const resolveNativeOrder = (preferredProvider: ImageSearchPreferredProvider): ImageProviderSource[] => {
  if (preferredProvider === "native" || preferredProvider === "google") return [...NATIVE_PROVIDER_ORDER];
  const preferred = preferredProvider as ImageProviderSource;
  if (!NATIVE_PROVIDER_ORDER.includes(preferred)) return [...NATIVE_PROVIDER_ORDER];

  return [preferred, ...NATIVE_PROVIDER_ORDER.filter((source) => source !== preferred)];
};

const sanitizeProviderError = (error: unknown): string => {
  if (!(error instanceof Error)) return "unknown_error";
  const text = error.message.replace(/\s+/g, " ").trim();
  return text || "unknown_error";
};

type RecentDeliveryRecord = {
  imageKey: string;
  source?: string;
  domain?: string;
  deliveredAt: number;
};

const normalizeQueryCacheKey = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

const getCandidateDomain = (candidate: { pageUrl?: string; link?: string; imageUrl: string }): string | undefined =>
  getHost(candidate.pageUrl || candidate.link || candidate.imageUrl) ?? getHost(candidate.imageUrl);

const weightedRandomIndex = (weights: number[]): number => {
  const safe = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  const random = Math.random() * total;
  let cursor = 0;
  for (let i = 0; i < safe.length; i += 1) {
    cursor += safe[i] ?? 0;
    if (random <= cursor) return i;
  }
  return Math.max(0, safe.length - 1);
};

const chooseDeliverableCandidate = (input: {
  candidates: ValidatedDeliverableCandidate[];
  variabilityPoolSize: number;
  recent?: RecentDeliveryRecord;
}): ValidatedDeliverableCandidate => {
  if (input.candidates.length <= 1) return input.candidates[0] as ValidatedDeliverableCandidate;

  const pool = input.candidates.slice(0, input.variabilityPoolSize);
  const recent = input.recent;
  const nonRepeated = recent ? pool.filter((candidate) => canonicalImageUrl(candidate.imageUrl) !== recent.imageKey) : pool;
  const activePool = nonRepeated.length > 0 ? nonRepeated : pool;

  const topSource = activePool[0]?.source;
  const hasSourceDiversity = new Set(activePool.map((candidate) => candidate.source)).size > 1;
  const hasDomainDiversity = new Set(activePool.map((candidate) => getCandidateDomain(candidate) ?? "")).size > 1;

  const weights = activePool.map((candidate, index) => {
    const rankWeight = Math.max(0.22, 1 - index * 0.18);
    let weight = rankWeight;

    const candidateKey = canonicalImageUrl(candidate.imageUrl);
    const candidateDomain = getCandidateDomain(candidate);

    if (recent) {
      if (candidateKey === recent.imageKey) weight *= 0.32;
      if (candidate.source && recent.source && candidate.source !== recent.source) weight *= 1.22;
      if (candidateDomain && recent.domain && candidateDomain !== recent.domain) weight *= 1.16;
    }

    if (hasSourceDiversity && topSource && candidate.source !== topSource) {
      weight *= 1.08;
    }
    if (hasDomainDiversity && recent?.domain && candidateDomain && candidateDomain !== recent.domain) {
      weight *= 1.06;
    }

    return weight;
  });

  const selectedIndex = weightedRandomIndex(weights);
  return activePool[selectedIndex] ?? activePool[0] ?? (input.candidates[0] as ValidatedDeliverableCandidate);
};

export const createImageSearchAdapter = (input: ImageSearchAdapterInput): ImageSearchPort => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;
  const preferredProvider = normalizePreferredProvider(input.preferredProvider);

  const mediaValidationTimeoutMs = clampInt(input.mediaValidationTimeoutMs ?? DEFAULT_MEDIA_VALIDATION_TIMEOUT_MS, 1_000, 20_000);
  const mediaValidationMaxBytes = clampInt(input.mediaValidationMaxBytes ?? DEFAULT_MEDIA_VALIDATION_MAX_BYTES, 64_000, 16 * 1024 * 1024);
  const mediaValidationMinBytes = clampInt(
    input.mediaValidationMinBytes ?? DEFAULT_MEDIA_VALIDATION_MIN_BYTES,
    1,
    Math.max(1, mediaValidationMaxBytes)
  );
  const mediaValidationCandidates = clampInt(input.mediaValidationCandidates ?? DEFAULT_MEDIA_VALIDATION_CANDIDATES, 1, 12);

  const mediaNormalizationConfig = {
    enabled: input.mediaNormalizationEnabled ?? DEFAULT_MEDIA_NORMALIZATION_ENABLED,
    maxDimension: clampInt(input.mediaNormalizationMaxDimension ?? DEFAULT_MEDIA_NORMALIZATION_MAX_DIMENSION, 256, 4_096),
    jpegQuality: clampInt(input.mediaNormalizationJpegQuality ?? DEFAULT_MEDIA_NORMALIZATION_JPEG_QUALITY, 45, 95),
    triggerBytes: clampInt(input.mediaNormalizationTriggerBytes ?? DEFAULT_MEDIA_NORMALIZATION_TRIGGER_BYTES, 64_000, mediaValidationMaxBytes)
  };
  const variabilityPoolSize = clampInt(input.variabilityPoolSize ?? DEFAULT_VARIABILITY_POOL_SIZE, 1, 8);
  const maxValidatedDeliverables = clampInt(
    input.maxValidatedDeliverables ?? Math.max(DEFAULT_MAX_VALIDATED_DELIVERABLES, variabilityPoolSize),
    1,
    12
  );
  const recentDeliveryTtlMs = clampInt(input.recentDeliveryTtlMs ?? DEFAULT_RECENT_DELIVERY_TTL_MS, 30_000, 86_400_000);
  const recentDeliveryCache = new Map<string, RecentDeliveryRecord>();

  const buildRecentDeliveryKey = (query: string, tenantId?: string): string => `${tenantId ?? "global"}::${normalizeQueryCacheKey(query)}`;

  const pruneRecentDeliveries = (): void => {
    const now = Date.now();
    for (const [key, value] of recentDeliveryCache) {
      if (now - value.deliveredAt > recentDeliveryTtlMs) {
        recentDeliveryCache.delete(key);
      }
    }

    if (recentDeliveryCache.size <= 2048) return;
    const keys = [...recentDeliveryCache.entries()]
      .sort((left, right) => left[1].deliveredAt - right[1].deliveredAt)
      .slice(0, recentDeliveryCache.size - 2048)
      .map((entry) => entry[0]);
    for (const key of keys) {
      recentDeliveryCache.delete(key);
    }
  };

  const readRecentDelivery = (query: string, tenantId?: string): RecentDeliveryRecord | undefined => {
    pruneRecentDeliveries();
    const key = buildRecentDeliveryKey(query, tenantId);
    const cached = recentDeliveryCache.get(key);
    if (!cached) return undefined;
    if (Date.now() - cached.deliveredAt > recentDeliveryTtlMs) {
      recentDeliveryCache.delete(key);
      return undefined;
    }
    return cached;
  };

  const writeRecentDelivery = (query: string, tenantId: string | undefined, candidate: ValidatedDeliverableCandidate): void => {
    const key = buildRecentDeliveryKey(query, tenantId);
    recentDeliveryCache.set(key, {
      imageKey: canonicalImageUrl(candidate.imageUrl),
      source: candidate.source,
      domain: getCandidateDomain(candidate),
      deliveredAt: Date.now()
    });
  };

  const googleEngineId = resolveGoogleEngineId({
    googleSearchEngineId: input.googleSearchEngineId,
    googleCx: input.googleCx
  });

  const providers: Record<ImageProviderSource, ImageProviderAdapter> = {
    wikimedia: createWikimediaImageProvider(),
    openverse: createOpenverseImageProvider({ apiBaseUrl: input.openverseApiBaseUrl }),
    pixabay: createPixabayImageProvider({ apiKey: input.pixabayApiKey }),
    pexels: createPexelsImageProvider({ apiKey: input.pexelsApiKey }),
    unsplash: createUnsplashImageProvider({ accessKey: input.unsplashAccessKey }),
    google_cse: createGoogleCseImageProvider({ apiKey: input.googleApiKey, cx: googleEngineId })
  };

  const searchProviderSafely = async (provider: ImageProviderAdapter, payload: { query: string; limit: number; locale?: string }) => {
    if (!provider.isConfigured()) {
      return {
        source: provider.source,
        configured: false,
        results: [] as ImageSearchResultItem[],
        correctedQuery: undefined as string | undefined,
        error: undefined as string | undefined
      };
    }

    try {
      const result = await provider.search({
        query: payload.query,
        limit: payload.limit,
        locale: payload.locale,
        timeoutMs,
        fetchImpl
      });

      return {
        source: provider.source,
        configured: true,
        results: result.results,
        correctedQuery: result.correctedQuery,
        error: undefined as string | undefined
      };
    } catch (error) {
      const reason = sanitizeProviderError(error);
      input.logger?.debug?.(
        {
          capability: "image-search",
          action: "provider_search",
          status: "failure",
          source: provider.source,
          reason,
          queryPreview: shorten(payload.query, 120)
        },
        "image provider search failed"
      );
      return {
        source: provider.source,
        configured: true,
        results: [] as ImageSearchResultItem[],
        correctedQuery: undefined as string | undefined,
        error: reason
      };
    }
  };

  return {
    search: async ({ tenantId, query, limit, locale }) => {
      const requestedLimit = clampInt(limit, 1, 8);
      const providerLimit = Math.max(requestedLimit + 2, mediaValidationCandidates, 4);

      const nativeOrder = resolveNativeOrder(preferredProvider);
      const nativeRuns = await Promise.all(
        nativeOrder.map((source) => searchProviderSafely(providers[source], { query, limit: providerLimit, locale }))
      );

      const nativeItems = nativeRuns.flatMap((entry) => entry.results);
      const rankedNative = rankAndFilterImageResults({ query, items: nativeItems, limit: providerLimit * 2 });

      const nativeValidation = await validateCandidatePool({
        query,
        provider: "native",
        items: rankedNative,
        fetchImpl,
        timeoutMs: mediaValidationTimeoutMs,
        maxBytes: mediaValidationMaxBytes,
        minBytes: mediaValidationMinBytes,
        maxCandidates: Math.max(requestedLimit, mediaValidationCandidates),
        logger: input.logger,
        normalization: mediaNormalizationConfig,
        maxDeliverables: maxValidatedDeliverables
      });

      if (nativeValidation.deliverableCandidates.length > 0) {
        const chosen = chooseDeliverableCandidate({
          candidates: nativeValidation.deliverableCandidates,
          variabilityPoolSize,
          recent: readRecentDelivery(query, tenantId)
        });
        writeRecentDelivery(query, tenantId, chosen);

        return {
          provider: chosen.source,
          requestedProvider: preferredProvider,
          fallbackUsed: false,
          results: rankedNative,
          deliverableImage: chosen,
          candidateDiagnostics: nativeValidation.candidateDiagnostics
        };
      }

      const googleProvider = providers.google_cse;
      const hasGoogleFallback = googleProvider.isConfigured();
      let fallbackUsed = false;
      let fallbackReason: string | undefined;
      let correctedQuery: string | undefined;
      let mergedResults = rankedNative;
      const diagnostics = [...nativeValidation.candidateDiagnostics];

      if (hasGoogleFallback) {
        fallbackUsed = true;
        fallbackReason = rankedNative.length > 0 ? "native_no_deliverable" : "native_no_results";

        const googleRun = await searchProviderSafely(googleProvider, { query, limit: providerLimit, locale });
        correctedQuery = googleRun.correctedQuery;

        const rankedGoogle = rankAndFilterImageResults({
          query: correctedQuery && correctedQuery.trim() ? correctedQuery : query,
          items: googleRun.results,
          limit: providerLimit * 2
        });

        if (rankedGoogle.length > 0) {
          mergedResults = rankAndFilterImageResults({
            query,
            items: [...rankedNative, ...rankedGoogle],
            limit: providerLimit * 2
          });

          const googleValidation = await validateCandidatePool({
            query,
            provider: "google_fallback",
            items: rankedGoogle,
            fetchImpl,
            timeoutMs: mediaValidationTimeoutMs,
            maxBytes: mediaValidationMaxBytes,
            minBytes: mediaValidationMinBytes,
            maxCandidates: Math.max(requestedLimit, mediaValidationCandidates),
            logger: input.logger,
            normalization: mediaNormalizationConfig,
            maxDeliverables: maxValidatedDeliverables,
            skipImageKeys: nativeValidation.triedImageKeys
          });

          diagnostics.push(...googleValidation.candidateDiagnostics);

          if (googleValidation.deliverableCandidates.length > 0) {
            const chosen = chooseDeliverableCandidate({
              candidates: googleValidation.deliverableCandidates,
              variabilityPoolSize,
              recent: readRecentDelivery(query, tenantId)
            });
            writeRecentDelivery(query, tenantId, chosen);

            return {
              provider: chosen.source,
              requestedProvider: preferredProvider,
              fallbackUsed,
              fallbackReason,
              correctedQuery,
              results: mergedResults,
              deliverableImage: chosen,
              candidateDiagnostics: diagnostics
            };
          }

          fallbackReason = `${fallbackReason}+google_no_deliverable`;
        } else {
          fallbackReason = `${fallbackReason}+google_no_results`;
        }

        if (googleRun.error) {
          fallbackReason = `${fallbackReason}+google_error`;
        }
      } else if (rankedNative.length === 0) {
        fallbackReason = "native_no_results+google_not_configured";
      } else {
        fallbackReason = "native_no_deliverable+google_not_configured";
      }

      const representativeSource = mergedResults[0]?.source ?? rankedNative[0]?.source;

      return {
        provider: representativeSource ?? (hasGoogleFallback ? "native+google_cse" : "native"),
        requestedProvider: preferredProvider,
        fallbackUsed,
        fallbackReason,
        correctedQuery,
        results: mergedResults,
        deliverableImage: undefined,
        candidateDiagnostics: diagnostics
      };
    }
  };
};
