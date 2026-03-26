import type { ImageSearchPort, ImageSearchResultItem, LoggerPort } from "@zappy/core";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ImageSearchAdapterInput {
  googleApiKey?: string;
  googleSearchEngineId?: string;
  googleCx?: string;
  timeoutMs?: number;
  preferredProvider?: "google" | "wikimedia";
  logger?: LoggerPort;
  fetchImpl?: FetchLike;
  mediaValidationTimeoutMs?: number;
  mediaValidationMaxBytes?: number;
  mediaValidationMinBytes?: number;
  mediaValidationCandidates?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MEDIA_VALIDATION_TIMEOUT_MS = 8_000;
const DEFAULT_MEDIA_VALIDATION_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MEDIA_VALIDATION_MIN_BYTES = 512;
const DEFAULT_MEDIA_VALIDATION_CANDIDATES = 5;

const normalizeOptional = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const resolveGoogleEngineId = (input: ImageSearchAdapterInput): string | undefined =>
  normalizeOptional(input.googleSearchEngineId) ?? normalizeOptional(input.googleCx);

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

const shorten = (value: string, max = 180): string => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);

const normalizeMimeType = (value?: string | null): string => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.split(";")[0]?.trim() ?? "";
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

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return true;
  }

  const gifSig = bytes.subarray(0, 6).toString("ascii");
  if (gifSig === "GIF87a" || gifSig === "GIF89a") {
    return true;
  }

  const riffSig = bytes.subarray(0, 4).toString("ascii");
  const webpSig = bytes.length >= 12 ? bytes.subarray(8, 12).toString("ascii") : "";
  if (riffSig === "RIFF" && webpSig === "WEBP") {
    return true;
  }

  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return true;
  }

  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return true;
  }

  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii").toLowerCase();
    if (["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return true;
    }
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

const fetchJson = async <T>(input: {
  url: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "zappy-assistant/1.5 (+image-search)"
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

const isLikelyImageUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) return false;
    return true;
  } catch {
    return false;
  }
};

const imageExtensionPenalty = (url: string): number => {
  const lower = url.toLowerCase();
  if (lower.endsWith(".svg") || lower.includes("format=svg")) return -3;
  if (lower.endsWith(".gif") || lower.includes("format=gif")) return -1;
  return 0;
};

const rankAndFilterImageResults = (input: { query: string; items: ImageSearchResultItem[]; limit: number }): ImageSearchResultItem[] => {
  const query = input.query.trim().toLowerCase();
  const tokens = tokenize(query);
  const seenImageUrls = new Set<string>();

  const scored = input.items
    .map((item) => {
      const title = item.title.trim();
      const imageUrl = item.imageUrl?.trim() || "";
      const link = item.link.trim();

      if (!title || !imageUrl || !link) return null;
      if (!isLikelyImageUrl(imageUrl)) return null;

      const imageKey = imageUrl.toLowerCase();
      if (seenImageUrls.has(imageKey)) return null;
      seenImageUrls.add(imageKey);

      const titleMatches = countTokenMatches(tokens, title);
      const imageMatches = countTokenMatches(tokens, imageUrl);
      const linkMatches = countTokenMatches(tokens, link);
      const fullQueryHit = query.length >= 4 && (title.toLowerCase().includes(query) || link.toLowerCase().includes(query));

      let score = 0;
      score += fullQueryHit ? 6 : 0;
      score += titleMatches * 2.8;
      score += linkMatches * 1.4;
      score += imageMatches * 1.2;
      score += imageExtensionPenalty(imageUrl);
      if (title.length < 6) score -= 1;

      return {
        item: {
          title,
          imageUrl,
          link
        } as ImageSearchResultItem,
        score,
        relevance: titleMatches + imageMatches + linkMatches
      };
    })
    .filter((value): value is { item: ImageSearchResultItem; score: number; relevance: number } => Boolean(value));

  const filtered = scored.filter((entry) => (tokens.length === 0 ? true : entry.relevance > 0));
  const pool = filtered.length > 0 ? filtered : scored;

  return pool
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((entry) => entry.item);
};

const googleImageSearch = async (input: {
  apiKey: string;
  cx: string;
  query: string;
  limit: number;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<{ results: ImageSearchResultItem[]; correctedQuery?: string }> => {
  const runGoogleQuery = async (query: string) => {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", input.apiKey);
    url.searchParams.set("cx", input.cx);
    url.searchParams.set("q", query);
    url.searchParams.set("searchType", "image");
    url.searchParams.set("safe", "active");
    url.searchParams.set("num", String(Math.min(10, Math.max(1, input.limit))));

    const payload = await fetchJson<{
      items?: Array<{ title?: string; link?: string; image?: { contextLink?: string } }>;
      spelling?: { correctedQuery?: string };
    }>({
      url: url.toString(),
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl
    });

    const mapped = (payload.items ?? [])
      .filter((item) => item && item.title && item.link)
      .map((item) => ({
        title: String(item.title),
        imageUrl: String(item.link),
        link: item.image?.contextLink ? String(item.image.contextLink) : String(item.link)
      }));

    return {
      correctedQuery: normalizeOptional(payload.spelling?.correctedQuery),
      results: rankAndFilterImageResults({ query, items: mapped, limit: input.limit })
    };
  };

  const first = await runGoogleQuery(input.query);
  const suggested = first.correctedQuery;
  if (first.results.length > 0 || !suggested || suggested.toLowerCase() === input.query.toLowerCase()) {
    return { results: first.results };
  }

  const retried = await runGoogleQuery(suggested);
  return { results: retried.results, correctedQuery: suggested };
};

const wikimediaImageSearch = async (input: {
  query: string;
  limit: number;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<ImageSearchResultItem[]> => {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", input.query);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", String(Math.min(10, Math.max(1, input.limit))));
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url");

  const payload = await fetchJson<{
    query?: {
      pages?: Record<string, { title?: string; imageinfo?: Array<{ url?: string; descriptionurl?: string }> }>;
    };
  }>({
    url: url.toString(),
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl
  });

  const pages = payload.query?.pages ?? {};
  const mapped = Object.values(pages)
    .map((page) => {
      const imageInfo = page.imageinfo?.[0];
      if (!imageInfo?.url) return null;
      return {
        title: page.title ?? "Imagem",
        imageUrl: imageInfo.url,
        link: imageInfo.descriptionurl ?? imageInfo.url
      } as ImageSearchResultItem;
    })
    .filter((item): item is ImageSearchResultItem => Boolean(item));

  return rankAndFilterImageResults({ query: input.query, items: mapped, limit: input.limit });
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
        "User-Agent": "zappy-assistant/1.5 (+image-search-delivery)"
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

const validateCandidatePool = async (input: {
  query: string;
  provider?: string;
  items: ImageSearchResultItem[];
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxBytes: number;
  minBytes: number;
  maxCandidates: number;
  logger?: LoggerPort;
}) => {
  const diagnostics: Array<{
    title: string;
    link: string;
    imageUrl: string;
    candidateIndex: number;
    status: "accepted" | "rejected";
    reason: string;
    httpStatus?: number;
    mimeType?: string;
    byteLength?: number;
  }> = [];

  const candidates = input.items.filter((item) => Boolean(item.imageUrl)).slice(0, input.maxCandidates);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const imageUrl = candidate.imageUrl!.trim();
    const candidateIndex = index + 1;
    const startedAt = Date.now();

    logMediaValidation(input.logger, {
      status: "started",
      query: input.query,
      provider: input.provider,
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
        title: candidate.title,
        link: candidate.link,
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

    diagnostics.push({
      title: candidate.title,
      link: candidate.link,
      imageUrl,
      candidateIndex,
      status: "accepted",
      reason: "ok",
      httpStatus: downloaded.httpStatus,
      mimeType: downloaded.mimeType,
      byteLength: downloaded.byteLength
    });

    logMediaValidation(input.logger, {
      status: "success",
      query: input.query,
      provider: input.provider,
      candidateIndex,
      imageUrl,
      reason: "ok",
      httpStatus: downloaded.httpStatus,
      mimeType: downloaded.mimeType,
      byteLength: downloaded.byteLength,
      elapsedMs
    });

    return {
      deliverableImage: {
        title: candidate.title,
        link: candidate.link,
        imageUrl,
        imageBase64: downloaded.buffer.toString("base64"),
        mimeType: downloaded.mimeType,
        byteLength: downloaded.byteLength,
        candidateIndex
      },
      candidateDiagnostics: diagnostics
    };
  }

  return {
    deliverableImage: undefined,
    candidateDiagnostics: diagnostics
  };
};

export const createImageSearchAdapter = (input: ImageSearchAdapterInput): ImageSearchPort => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;
  const mediaValidationTimeoutMs = clampInt(input.mediaValidationTimeoutMs ?? DEFAULT_MEDIA_VALIDATION_TIMEOUT_MS, 1_000, 20_000);
  const mediaValidationMaxBytes = clampInt(input.mediaValidationMaxBytes ?? DEFAULT_MEDIA_VALIDATION_MAX_BYTES, 64_000, 16 * 1024 * 1024);
  const mediaValidationMinBytes = clampInt(
    input.mediaValidationMinBytes ?? DEFAULT_MEDIA_VALIDATION_MIN_BYTES,
    1,
    Math.max(1, mediaValidationMaxBytes)
  );
  const mediaValidationCandidates = clampInt(input.mediaValidationCandidates ?? DEFAULT_MEDIA_VALIDATION_CANDIDATES, 1, 10);
  const googleApiKey = normalizeOptional(input.googleApiKey);
  const googleEngineId = resolveGoogleEngineId(input);
  const hasGoogleConfig = Boolean(googleApiKey && googleEngineId);

  return {
    search: async ({ query, limit }) => {
      const preferred = input.preferredProvider ?? "google";
      const requestedLimit = clampInt(limit, 1, 8);
      const providerLimit = Math.max(requestedLimit, mediaValidationCandidates);

      const runGoogle = async () => {
        if (!hasGoogleConfig) return { results: [], correctedQuery: undefined as string | undefined };
        return googleImageSearch({
          apiKey: googleApiKey!,
          cx: googleEngineId!,
          query,
          limit: providerLimit,
          timeoutMs,
          fetchImpl
        });
      };

      const withValidatedDelivery = async (payload: {
        provider: string;
        requestedProvider: "google" | "wikimedia";
        results: ImageSearchResultItem[];
        fallbackUsed?: boolean;
        fallbackReason?: string;
        correctedQuery?: string;
      }) => {
        const normalizedResults = payload.results.slice(0, providerLimit);
        const validated = await validateCandidatePool({
          query,
          provider: payload.provider,
          items: normalizedResults,
          fetchImpl,
          timeoutMs: mediaValidationTimeoutMs,
          maxBytes: mediaValidationMaxBytes,
          minBytes: mediaValidationMinBytes,
          maxCandidates: Math.max(requestedLimit, mediaValidationCandidates),
          logger: input.logger
        });

        return {
          provider: payload.provider,
          requestedProvider: payload.requestedProvider,
          fallbackUsed: payload.fallbackUsed,
          fallbackReason: payload.fallbackReason,
          correctedQuery: payload.correctedQuery,
          results: normalizedResults,
          deliverableImage: validated.deliverableImage,
          candidateDiagnostics: validated.candidateDiagnostics
        };
      };

      let fallbackUsed = false;
      let fallbackReason: string | undefined;
      let correctedQuery: string | undefined;

      if (preferred === "google") {
        if (!hasGoogleConfig) {
          fallbackUsed = true;
          fallbackReason = "google_not_configured";
        } else {
          try {
            const googleResults = await runGoogle();
            correctedQuery = googleResults.correctedQuery;
            if (googleResults.results.length > 0) {
              return withValidatedDelivery({
                provider: "google_cse",
                requestedProvider: "google",
                fallbackUsed: false,
                correctedQuery,
                results: googleResults.results
              });
            }
            fallbackUsed = true;
            fallbackReason = "google_no_results";
          } catch {
            fallbackUsed = true;
            fallbackReason = "google_error";
          }
        }
        const wikiResults = await wikimediaImageSearch({ query, limit: providerLimit, timeoutMs, fetchImpl });
        if (wikiResults.length > 0) {
          return withValidatedDelivery({
            provider: "wikimedia",
            requestedProvider: "google",
            fallbackUsed,
            fallbackReason,
            correctedQuery,
            results: wikiResults
          });
        }
        return {
          provider: hasGoogleConfig ? "google_cse+wikimedia" : "wikimedia",
          requestedProvider: "google",
          fallbackUsed,
          fallbackReason,
          correctedQuery,
          results: [],
          deliverableImage: undefined,
          candidateDiagnostics: []
        };
      }

      const wikiResults = await wikimediaImageSearch({ query, limit: providerLimit, timeoutMs, fetchImpl });
      if (wikiResults.length > 0) {
        return withValidatedDelivery({
          provider: "wikimedia",
          requestedProvider: "wikimedia",
          fallbackUsed: false,
          results: wikiResults
        });
      }

      fallbackUsed = true;
      fallbackReason = "wikimedia_no_results";

      if (hasGoogleConfig) {
        try {
          const googleResults = await runGoogle();
          correctedQuery = googleResults.correctedQuery;
          if (googleResults.results.length > 0) {
            return withValidatedDelivery({
              provider: "google_cse",
              requestedProvider: "wikimedia",
              fallbackUsed,
              fallbackReason,
              correctedQuery,
              results: googleResults.results
            });
          }
        } catch {
          fallbackReason = "wikimedia_no_results+google_error";
        }
      }

      return {
        provider: hasGoogleConfig ? "wikimedia+google_cse" : "wikimedia",
        requestedProvider: "wikimedia",
        fallbackUsed,
        fallbackReason,
        correctedQuery,
        results: [],
        deliverableImage: undefined,
        candidateDiagnostics: []
      };
    }
  };
};
