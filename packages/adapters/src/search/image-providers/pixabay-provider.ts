import type { ImageProviderAdapter } from "./types.js";
import { buildCandidate, fetchJson, normalizeOptional } from "./common.js";

export const createPixabayImageProvider = (input: { apiKey?: string }): ImageProviderAdapter => ({
  source: "pixabay",
  isConfigured: () => Boolean(normalizeOptional(input.apiKey)),
  search: async ({ query, limit, timeoutMs, fetchImpl }) => {
    const apiKey = normalizeOptional(input.apiKey);
    if (!apiKey) return { results: [] };

    const url = new URL("https://pixabay.com/api/");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("q", query);
    url.searchParams.set("image_type", "photo");
    url.searchParams.set("safesearch", "true");
    url.searchParams.set("per_page", String(Math.min(20, Math.max(1, limit))));

    const payload = await fetchJson<{
      hits?: Array<{
        tags?: string;
        pageURL?: string;
        largeImageURL?: string;
        webformatURL?: string;
        previewURL?: string;
        user?: string;
      }>;
    }>({
      url: url.toString(),
      timeoutMs,
      fetchImpl
    });

    const results = (payload.hits ?? [])
      .map((item) =>
        buildCandidate({
          source: "pixabay",
          title: item.tags ?? "Imagem Pixabay",
          pageUrl: item.pageURL,
          imageUrl: item.largeImageURL ?? item.webformatURL ?? item.previewURL,
          thumbnailUrl: item.previewURL ?? item.webformatURL,
          attribution: item.user ? `Photo by ${item.user} on Pixabay` : undefined,
          providerConfidence: 0.92,
          licenseInfo: {
            name: "Pixabay License",
            url: "https://pixabay.com/service/license-summary/",
            requiresAttribution: false
          }
        })
      )
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return { results };
  }
});
