import { strict as assert } from "node:assert";
import test from "node:test";
import { createYoutubeServiceBridgeProvider } from "../src/infrastructure/providers/youtube-service-bridge-provider.js";
import { createFacebookServiceBridgeProvider } from "../src/infrastructure/providers/facebook-service-bridge-provider.js";

test("youtube service bridge: maps ready download payload to normalized video asset", async () => {
  const bridge = createYoutubeServiceBridgeProvider({
    baseUrl: "http://yt-resolver.local",
    timeoutMs: 5_000,
    maxBytes: 16 * 1024 * 1024,
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://yt-resolver.local/resolve");
      assert.equal(String(init?.method ?? "GET").toUpperCase(), "POST");
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            status: "ok",
            result_kind: "video_post",
            direct_url: "https://cdn.example/youtube/video.mp4",
            mime_type: "video/mp4",
            title: "Test video"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
  });

  const result = await bridge.provider.download({
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  });

  assert.equal(result.provider, "yt");
  assert.equal(result.status, "ready");
  assert.equal(result.resultKind, "video_post");
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0]?.kind, "video");
  assert.equal(result.assets[0]?.directUrl, "https://cdn.example/youtube/video.mp4");
});

test("youtube service bridge: maps preview-only probe status", async () => {
  const bridge = createYoutubeServiceBridgeProvider({
    baseUrl: "http://yt-resolver.local",
    timeoutMs: 5_000,
    maxBytes: 16 * 1024 * 1024,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            status: "preview_only",
            reason: "preview_only"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
  });

  const probe = await bridge.provider.probe({
    url: "https://www.youtube.com/shorts/dQw4w9WgXcQ"
  });

  assert.equal(probe.status, "unsupported");
  assert.equal(probe.resultKind, "preview_only");
});

test("facebook service bridge: maps private probe status to blocked/private", async () => {
  const bridge = createFacebookServiceBridgeProvider({
    baseUrl: "http://fb-resolver.local",
    timeoutMs: 5_000,
    maxBytes: 16 * 1024 * 1024,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            status: "private",
            reason: "private"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
  });

  const probe = await bridge.provider.probe({
    url: "https://www.facebook.com/watch/?v=1234567890"
  });

  assert.equal(probe.provider, "fb");
  assert.equal(probe.status, "blocked");
  assert.equal(probe.resultKind, "private");
});

test("facebook service bridge: maps resolver HTTP failure to error", async () => {
  const bridge = createFacebookServiceBridgeProvider({
    baseUrl: "http://fb-resolver.local",
    timeoutMs: 5_000,
    maxBytes: 16 * 1024 * 1024,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: "upstream unavailable"
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/json"
          }
        }
      )
  });

  const result = await bridge.provider.download({
    url: "https://www.facebook.com/reel/123456"
  });

  assert.equal(result.provider, "fb");
  assert.equal(result.status, "error");
  assert.equal(result.resultKind, "unsupported");
  assert.equal(result.reason, "resolver_http_503");
});
