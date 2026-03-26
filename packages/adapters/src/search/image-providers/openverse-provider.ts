import type { ImageProviderAdapter } from "./types.js";
import { buildCandidate, fetchJson, normalizeOptional } from "./common.js";

export const createOpenverseImageProvider = (input?: { apiBaseUrl?: string }): ImageProviderAdapter => ({
  source: "openverse",
  isConfigured: () => true,
  search: async ({ query, limit, timeoutMs, fetchImpl }) => {
    const baseUrl = normalizeOptional(input?.apiBaseUrl) ?? "https://api.openverse.org/v1/images/";
    const url = new URL(baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("page_size", String(Math.min(20, Math.max(1, limit))));
    url.searchParams.set("mature", "false");

    const payload = await fetchJson<{
      results?: Array<{
        title?: string;
        url?: string;
        thumbnail?: string;
        mimetype?: string;
        creator?: string;
        foreign_landing_url?: string;
        license?: string;
        license_version?: string;
        license_url?: string;
        provider?: string;
      }>;
    }>({
      url: url.toString(),
      timeoutMs,
      fetchImpl
    });

    const results = (payload.results ?? [])
      .map((item) =>
        buildCandidate({
          source: "openverse",
          title: item.title ?? "Imagem Openverse",
          pageUrl: item.foreign_landing_url ?? item.url,
          imageUrl: item.url,
          thumbnailUrl: item.thumbnail,
          mimeType: item.mimetype,
          attribution: item.creator,
          providerConfidence: 0.95,
          licenseInfo: {
            code: item.license,
            name: item.license,
            version: item.license_version,
            url: item.license_url,
            requiresAttribution: true
          }
        })
      )
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return { results };
  }
});
