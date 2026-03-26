import type { ImageProviderAdapter } from "./types.js";
import { buildCandidate, fetchJson, normalizeOptional } from "./common.js";

export const createGoogleCseImageProvider = (input: { apiKey?: string; cx?: string }): ImageProviderAdapter => ({
  source: "google_cse",
  isConfigured: () => Boolean(normalizeOptional(input.apiKey) && normalizeOptional(input.cx)),
  search: async ({ query, limit, timeoutMs, fetchImpl }) => {
    const apiKey = normalizeOptional(input.apiKey);
    const cx = normalizeOptional(input.cx);
    if (!apiKey || !cx) return { results: [] };

    const runGoogleQuery = async (targetQuery: string) => {
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", cx);
      url.searchParams.set("q", targetQuery);
      url.searchParams.set("searchType", "image");
      url.searchParams.set("safe", "active");
      url.searchParams.set("num", String(Math.min(10, Math.max(1, limit))));

      const payload = await fetchJson<{
        items?: Array<{
          title?: string;
          link?: string;
          image?: {
            contextLink?: string;
            thumbnailLink?: string;
            mime?: string;
          };
        }>;
        spelling?: { correctedQuery?: string };
      }>({
        url: url.toString(),
        timeoutMs,
        fetchImpl
      });

      const results = (payload.items ?? [])
        .map((item) =>
          buildCandidate({
            source: "google_cse",
            title: item.title ?? "Imagem",
            pageUrl: item.image?.contextLink ?? item.link,
            imageUrl: item.link,
            thumbnailUrl: item.image?.thumbnailLink,
            mimeType: item.image?.mime,
            providerConfidence: 0.56
          })
        )
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

      return {
        correctedQuery: normalizeOptional(payload.spelling?.correctedQuery),
        results
      };
    };

    const first = await runGoogleQuery(query);
    const suggested = first.correctedQuery;
    if (first.results.length > 0 || !suggested || suggested.toLowerCase() === query.toLowerCase()) {
      return { results: first.results };
    }

    const retried = await runGoogleQuery(suggested);
    return {
      results: retried.results,
      correctedQuery: suggested
    };
  }
});
