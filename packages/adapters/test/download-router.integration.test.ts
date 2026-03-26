import { strict as assert } from "node:assert";
import test from "node:test";
import { createMediaDownloadRouter } from "../src/downloads/router.js";

test("integration: downloads router auto-selects instagram provider for instagram links", async () => {
  const calls: string[] = [];

  const router = createMediaDownloadRouter({
    providers: [
      {
        provider: "ig",
        detect: ({ url }) =>
          url.includes("instagram.com")
            ? {
                provider: "ig",
                family: "instagram",
                normalizedUrl: url,
                confidence: 0.99,
                reason: "instagram_reel"
              }
            : null,
        probe: async (input) => {
          calls.push(`probe:${input.url}`);
          return {
            provider: "ig",
            status: "ready",
            sourceUrl: input.url,
            canonicalUrl: input.url,
            title: "reel test"
          };
        },
        downloadWithProbe: async ({ request }) => {
          calls.push(`download:${request.url}`);
          return {
            provider: "ig",
            status: "ready",
            sourceUrl: request.url,
            canonicalUrl: request.url,
            title: "reel test",
            assets: [
              {
                kind: "video",
                mimeType: "video/mp4",
                directUrl: "https://cdn.example.com/reel.mp4"
              }
            ]
          };
        },
        download: async (input) => {
          calls.push(`download-fallback:${input.url}`);
          return {
            provider: "ig",
            status: "ready",
            sourceUrl: input.url,
            canonicalUrl: input.url,
            assets: []
          };
        }
      },
      {
        provider: "direct",
        detect: ({ url }) => ({
          provider: "direct",
          family: "direct",
          normalizedUrl: url,
          confidence: 0.2,
          reason: "generic_http_url"
        }),
        probe: async (input) => ({
          provider: "direct",
          status: "ready",
          sourceUrl: input.url,
          canonicalUrl: input.url
        }),
        download: async (input) => ({
          provider: "direct",
          status: "ready",
          sourceUrl: input.url,
          canonicalUrl: input.url,
          assets: []
        })
      }
    ]
  });

  const result = await router.resolve({
    url: "https://www.instagram.com/reel/abc123/"
  });

  assert.equal(result.provider, "ig");
  assert.equal(result.detectedProvider, "ig");
  assert.equal(result.status, "ready");
  assert.equal(result.asset?.kind, "video");
  assert.deepEqual(calls, ["probe:https://www.instagram.com/reel/abc123/", "download:https://www.instagram.com/reel/abc123/"]);
});
