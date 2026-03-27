import { strict as assert } from "node:assert";
import test from "node:test";
import { createYoutubeDownloadProvider } from "../src/downloads/providers/youtube-provider.js";

test("unit: youtube detect normalizes watch and short urls", () => {
  const provider = createYoutubeDownloadProvider();

  const watch = provider.detect({
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=15s"
  });
  assert.equal(watch?.provider, "yt");
  assert.equal(watch?.family, "youtube");
  assert.equal(watch?.reason, "youtube_watch");
  assert.equal(watch?.normalizedUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  const short = provider.detect({
    url: "https://youtu.be/dQw4w9WgXcQ"
  });
  assert.equal(short?.reason, "youtube_watch");
  assert.equal(short?.normalizedUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("integration: youtube probe stays blocked by default compliance mode", async () => {
  const provider = createYoutubeDownloadProvider();
  const probe = await provider.probe({
    url: "https://www.youtube.com/shorts/dQw4w9WgXcQ"
  });

  assert.equal(probe.provider, "yt");
  assert.equal(probe.status, "blocked");
  assert.match(probe.reason ?? "", /compliance|licenciamento/i);
});

test("integration: youtube staged flow reaches resolveAsset in prepare-only mode", async () => {
  const provider = createYoutubeDownloadProvider({
    complianceMode: "prepare_only",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/oembed")) {
        return new Response(
          JSON.stringify({
            title: "Never Gonna Give You Up",
            thumbnail_url: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
      return new Response("", { status: 404 });
    }
  });
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  const probe = await provider.probe({ url });
  assert.equal(probe.status, "ready");

  const execution = await provider.downloadWithProbe!({
    probe,
    request: { url }
  });

  assert.equal(execution.provider, "yt");
  assert.equal(execution.status, "unsupported");
  assert.equal(execution.resultKind, "preview_only");
  assert.equal(execution.reason, "preview_only");
  assert.equal(execution.assets.length, 0);
});
