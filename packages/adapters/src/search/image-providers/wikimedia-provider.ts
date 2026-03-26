import type { ImageProviderAdapter } from "./types.js";
import { buildCandidate, fetchJson, normalizeOptional, stripHtml } from "./common.js";

const parseMetadata = (
  extmetadata?: Record<string, { value?: string } | undefined>
): {
  attribution?: string;
  licenseName?: string;
  licenseCode?: string;
  licenseVersion?: string;
  licenseUrl?: string;
} => {
  const rawAttribution = normalizeOptional(extmetadata?.Artist?.value) ?? normalizeOptional(extmetadata?.Credit?.value);
  const attribution = rawAttribution ? stripHtml(rawAttribution) : undefined;
  const licenseName = normalizeOptional(extmetadata?.LicenseShortName?.value) ?? normalizeOptional(extmetadata?.UsageTerms?.value);
  const licenseCode = normalizeOptional(extmetadata?.License?.value);
  const licenseVersion = normalizeOptional(extmetadata?.LicenseShortName?.value)?.match(/\d+(?:\.\d+)?/)?.[0];
  const licenseUrl = normalizeOptional(extmetadata?.LicenseUrl?.value);

  return {
    attribution,
    licenseName,
    licenseCode,
    licenseVersion,
    licenseUrl
  };
};

export const createWikimediaImageProvider = (): ImageProviderAdapter => ({
  source: "wikimedia",
  isConfigured: () => true,
  search: async ({ query, limit, timeoutMs, fetchImpl }) => {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", query);
    url.searchParams.set("gsrnamespace", "6");
    url.searchParams.set("gsrlimit", String(Math.min(20, Math.max(1, limit))));
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("iiprop", "url|mime|extmetadata");

    const payload = await fetchJson<{
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              url?: string;
              descriptionurl?: string;
              mime?: string;
              extmetadata?: Record<string, { value?: string } | undefined>;
            }>;
          }
        >;
      };
    }>({
      url: url.toString(),
      timeoutMs,
      fetchImpl
    });

    const pages = payload.query?.pages ?? {};
    const results = Object.values(pages)
      .map((page) => {
        const imageInfo = page.imageinfo?.[0];
        if (!imageInfo?.url) return null;

        const metadata = parseMetadata(imageInfo.extmetadata);
        return buildCandidate({
          source: "wikimedia",
          title: page.title?.replace(/^File:/i, "") ?? "Imagem Wikimedia",
          pageUrl: imageInfo.descriptionurl ?? imageInfo.url,
          imageUrl: imageInfo.url,
          mimeType: imageInfo.mime,
          attribution: metadata.attribution,
          providerConfidence: 0.98,
          licenseInfo: {
            name: metadata.licenseName,
            code: metadata.licenseCode,
            version: metadata.licenseVersion,
            url: metadata.licenseUrl,
            requiresAttribution: true
          }
        });
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return { results };
  }
});
