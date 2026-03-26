import type { ImageLicenseInfo, ImageSearchResultItem } from "@zappy/core";
import type { FetchLike, ImageProviderSource } from "./types.js";

export const normalizeOptional = (value?: string | null): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

export const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

export const resolveGoogleEngineId = (input: { googleSearchEngineId?: string; googleCx?: string }): string | undefined =>
  normalizeOptional(input.googleSearchEngineId) ?? normalizeOptional(input.googleCx);

export const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const asHttpUrl = (value?: string): string | undefined => {
  const normalized = normalizeOptional(value);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    if (!/^https?:$/i.test(url.protocol)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
};

export const inferMimeTypeFromUrl = (value?: string): string | undefined => {
  const url = normalizeOptional(value)?.toLowerCase();
  if (!url) return undefined;
  if (url.endsWith(".jpg") || url.endsWith(".jpeg") || url.includes("format=jpg") || url.includes("format=jpeg")) return "image/jpeg";
  if (url.endsWith(".png") || url.includes("format=png")) return "image/png";
  if (url.endsWith(".webp") || url.includes("format=webp")) return "image/webp";
  if (url.endsWith(".gif") || url.includes("format=gif")) return "image/gif";
  if (url.endsWith(".bmp")) return "image/bmp";
  if (url.endsWith(".tif") || url.endsWith(".tiff")) return "image/tiff";
  if (url.endsWith(".avif") || url.includes("format=avif")) return "image/avif";
  if (url.endsWith(".heic")) return "image/heic";
  if (url.endsWith(".heif")) return "image/heif";
  if (url.endsWith(".svg") || url.includes("format=svg")) return "image/svg+xml";
  return undefined;
};

const normalizeLicenseInfo = (license?: ImageLicenseInfo): ImageLicenseInfo | undefined => {
  if (!license) return undefined;
  const normalized: ImageLicenseInfo = {
    code: normalizeOptional(license.code),
    name: normalizeOptional(license.name),
    version: normalizeOptional(license.version),
    url: asHttpUrl(license.url),
    requiresAttribution: Boolean(license.requiresAttribution)
  };
  if (!normalized.code && !normalized.name && !normalized.version && !normalized.url && !normalized.requiresAttribution) {
    return undefined;
  }
  return normalized;
};

export const buildCandidate = (input: {
  source: ImageProviderSource;
  title?: string;
  pageUrl?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  attribution?: string;
  providerConfidence?: number;
  licenseInfo?: ImageLicenseInfo;
}): ImageSearchResultItem | null => {
  const imageUrl = asHttpUrl(input.imageUrl);
  if (!imageUrl) return null;

  const pageUrl = asHttpUrl(input.pageUrl) ?? imageUrl;
  const title = normalizeOptional(input.title) ?? "Imagem";
  const mimeType = normalizeOptional(input.mimeType) ?? inferMimeTypeFromUrl(imageUrl);
  const attribution = normalizeOptional(input.attribution);
  const providerConfidenceRaw = Number.isFinite(input.providerConfidence) ? Number(input.providerConfidence) : undefined;
  const providerConfidence =
    providerConfidenceRaw === undefined ? undefined : Math.min(1, Math.max(0, providerConfidenceRaw));
  const normalizedLicense = normalizeLicenseInfo(input.licenseInfo);

  return {
    source: input.source,
    title,
    link: pageUrl,
    pageUrl,
    imageUrl,
    thumbnailUrl: asHttpUrl(input.thumbnailUrl),
    mimeType,
    attribution,
    providerConfidence,
    licenseInfo: normalizedLicense
  };
};

export const fetchJson = async <T>(input: {
  url: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  headers?: Record<string, string>;
}): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await input.fetchImpl(input.url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "zappy-assistant/1.6 (+image-search)",
        ...(input.headers ?? {})
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};
