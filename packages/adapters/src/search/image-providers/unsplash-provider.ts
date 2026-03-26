import type { ImageProviderAdapter } from "./types.js";
import { buildCandidate, fetchJson, normalizeOptional } from "./common.js";

export const createUnsplashImageProvider = (input: { accessKey?: string }): ImageProviderAdapter => ({
  source: "unsplash",
  isConfigured: () => Boolean(normalizeOptional(input.accessKey)),
  search: async ({ query, limit, timeoutMs, fetchImpl }) => {
    const accessKey = normalizeOptional(input.accessKey);
    if (!accessKey) return { results: [] };

    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", String(Math.min(20, Math.max(1, limit))));
    url.searchParams.set("content_filter", "high");

    const payload = await fetchJson<{
      results?: Array<{
        alt_description?: string;
        description?: string;
        links?: { html?: string };
        urls?: { raw?: string; full?: string; regular?: string; small?: string; thumb?: string };
        user?: { name?: string };
      }>;
    }>({
      url: url.toString(),
      timeoutMs,
      fetchImpl,
      headers: {
        Authorization: `Client-ID ${accessKey}`
      }
    });

    const results = (payload.results ?? [])
      .map((item) =>
        buildCandidate({
          source: "unsplash",
          title: item.alt_description ?? item.description ?? "Imagem Unsplash",
          pageUrl: item.links?.html,
          imageUrl: item.urls?.regular ?? item.urls?.full ?? item.urls?.raw,
          thumbnailUrl: item.urls?.small ?? item.urls?.thumb,
          attribution: item.user?.name ? `Photo by ${item.user.name} on Unsplash` : undefined,
          providerConfidence: 0.88,
          licenseInfo: {
            name: "Unsplash License",
            url: "https://unsplash.com/license",
            requiresAttribution: true
          }
        })
      )
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return { results };
  }
});
