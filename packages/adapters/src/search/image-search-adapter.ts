import type { ImageSearchPort, ImageSearchResultItem } from "@zappy/core";

export interface ImageSearchAdapterInput {
  googleApiKey?: string;
  googleSearchEngineId?: string;
  googleCx?: string;
  timeoutMs?: number;
  preferredProvider?: "google" | "wikimedia";
}

const DEFAULT_TIMEOUT_MS = 10_000;

const normalizeOptional = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
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

const fetchJson = async <T>(url: string, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
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
    }>(url.toString(), input.timeoutMs);

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
  }>(url.toString(), input.timeoutMs);

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

export const createImageSearchAdapter = (input: ImageSearchAdapterInput): ImageSearchPort => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const googleApiKey = normalizeOptional(input.googleApiKey);
  const googleEngineId = resolveGoogleEngineId(input);
  const hasGoogleConfig = Boolean(googleApiKey && googleEngineId);

  return {
    search: async ({ query, limit }) => {
      const preferred = input.preferredProvider ?? "google";

      const runGoogle = async () => {
        if (!hasGoogleConfig) return { results: [], correctedQuery: undefined as string | undefined };
        return googleImageSearch({
          apiKey: googleApiKey!,
          cx: googleEngineId!,
          query,
          limit,
          timeoutMs
        });
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
              return {
                provider: "google_cse",
                requestedProvider: "google",
                fallbackUsed: false,
                correctedQuery,
                results: googleResults.results.slice(0, limit)
              };
            }
            fallbackUsed = true;
            fallbackReason = "google_no_results";
          } catch {
            fallbackUsed = true;
            fallbackReason = "google_error";
          }
        }
        const wikiResults = await wikimediaImageSearch({ query, limit, timeoutMs });
        if (wikiResults.length > 0) {
          return {
            provider: "wikimedia",
            requestedProvider: "google",
            fallbackUsed,
            fallbackReason,
            correctedQuery,
            results: wikiResults
          };
        }
        return {
          provider: hasGoogleConfig ? "google_cse+wikimedia" : "wikimedia",
          requestedProvider: "google",
          fallbackUsed,
          fallbackReason,
          correctedQuery,
          results: []
        };
      }

      const wikiResults = await wikimediaImageSearch({ query, limit, timeoutMs });
      if (wikiResults.length > 0) {
        return {
          provider: "wikimedia",
          requestedProvider: "wikimedia",
          fallbackUsed: false,
          results: wikiResults
        };
      }

      fallbackUsed = true;
      fallbackReason = "wikimedia_no_results";

      if (hasGoogleConfig) {
        try {
          const googleResults = await runGoogle();
          correctedQuery = googleResults.correctedQuery;
          if (googleResults.results.length > 0) {
            return {
              provider: "google_cse",
              requestedProvider: "wikimedia",
              fallbackUsed,
              fallbackReason,
              correctedQuery,
              results: googleResults.results.slice(0, limit)
            };
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
        results: []
      };
    }
  };
};
