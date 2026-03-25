import type { ImageSearchPort, ImageSearchResultItem } from "@zappy/core";

export interface ImageSearchAdapterInput {
  googleApiKey?: string;
  googleCx?: string;
  timeoutMs?: number;
  preferredProvider?: "google" | "wikimedia";
}

const DEFAULT_TIMEOUT_MS = 10_000;

const fetchJson = async <T>(url: string, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
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

const googleImageSearch = async (input: {
  apiKey: string;
  cx: string;
  query: string;
  limit: number;
  timeoutMs: number;
}): Promise<ImageSearchResultItem[]> => {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", input.apiKey);
  url.searchParams.set("cx", input.cx);
  url.searchParams.set("q", input.query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(Math.min(10, Math.max(1, input.limit))));

  const payload = await fetchJson<{
    items?: Array<{ title?: string; link?: string; image?: { contextLink?: string } }>;
  }>(url.toString(), input.timeoutMs);

  const items = payload.items ?? [];
  return items
    .filter((item) => item && item.title && item.link)
    .map((item) => ({
      title: String(item.title),
      imageUrl: String(item.link),
      link: item.image?.contextLink ? String(item.image.contextLink) : String(item.link)
    }));
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
  return Object.values(pages)
    .map((page) => {
      const imageInfo = page.imageinfo?.[0];
      if (!imageInfo?.url) return null;
      return {
        title: page.title ?? "Imagem",
        imageUrl: imageInfo.url,
        link: imageInfo.descriptionurl ?? imageInfo.url
      } as ImageSearchResultItem;
    })
    .filter((item): item is ImageSearchResultItem => Boolean(item))
    .slice(0, input.limit);
};

export const createImageSearchAdapter = (input: ImageSearchAdapterInput): ImageSearchPort => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    search: async ({ query, limit }) => {
      const preferred = input.preferredProvider ?? "google";
      const hasGoogleConfig = Boolean(input.googleApiKey && input.googleCx);

      const runGoogle = async () => {
        if (!hasGoogleConfig) return [];
        return googleImageSearch({
          apiKey: input.googleApiKey!,
          cx: input.googleCx!,
          query,
          limit,
          timeoutMs
        });
      };

      if (preferred === "google") {
        try {
          const googleResults = await runGoogle();
          if (googleResults.length > 0) return { provider: "google_cse", results: googleResults.slice(0, limit) };
        } catch {
          // fallback abaixo
        }
      }

      const wikiResults = await wikimediaImageSearch({ query, limit, timeoutMs });
      if (wikiResults.length > 0) return { provider: "wikimedia", results: wikiResults };

      if (preferred !== "google") {
        try {
          const googleResults = await runGoogle();
          if (googleResults.length > 0) return { provider: "google_cse", results: googleResults.slice(0, limit) };
        } catch {
          // sem resultados
        }
      }

      return { provider: hasGoogleConfig ? "google_cse+wikimedia" : "wikimedia", results: [] };
    }
  };
};
