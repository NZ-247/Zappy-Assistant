import type { ImageProviderAdapter } from "./types.js";
import { buildCandidate, fetchJson, normalizeOptional } from "./common.js";

export const createPexelsImageProvider = (input: { apiKey?: string }): ImageProviderAdapter => ({
  source: "pexels",
  isConfigured: () => Boolean(normalizeOptional(input.apiKey)),
  search: async ({ query, limit, timeoutMs, fetchImpl }) => {
    const apiKey = normalizeOptional(input.apiKey);
    if (!apiKey) return { results: [] };

    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", String(Math.min(20, Math.max(1, limit))));

    const payload = await fetchJson<{
      photos?: Array<{
        alt?: string;
        url?: string;
        photographer?: string;
        src?: {
          original?: string;
          large2x?: string;
          large?: string;
          medium?: string;
          small?: string;
        };
      }>;
    }>({
      url: url.toString(),
      timeoutMs,
      fetchImpl,
      headers: {
        Authorization: apiKey
      }
    });

    const results = (payload.photos ?? [])
      .map((photo) =>
        buildCandidate({
          source: "pexels",
          title: photo.alt ?? "Imagem Pexels",
          pageUrl: photo.url,
          imageUrl: photo.src?.large2x ?? photo.src?.original ?? photo.src?.large ?? photo.src?.medium,
          thumbnailUrl: photo.src?.medium ?? photo.src?.small,
          attribution: photo.photographer ? `Photo by ${photo.photographer} on Pexels` : undefined,
          providerConfidence: 0.9,
          licenseInfo: {
            name: "Pexels License",
            url: "https://www.pexels.com/license/",
            requiresAttribution: false
          }
        })
      )
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return { results };
  }
});
