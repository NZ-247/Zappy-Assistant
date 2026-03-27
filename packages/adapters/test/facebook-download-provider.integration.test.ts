import { strict as assert } from "node:assert";
import test from "node:test";
import { createFacebookDownloadProvider } from "../src/downloads/providers/facebook-provider.js";

test("unit: facebook detect normalizes watch and reel urls", () => {
  const provider = createFacebookDownloadProvider();

  const watch = provider.detect({
    url: "https://www.facebook.com/watch/?v=1234567890"
  });
  assert.equal(watch?.provider, "fb");
  assert.equal(watch?.family, "facebook");
  assert.equal(watch?.reason, "facebook_watch");
  assert.equal(watch?.normalizedUrl, "https://www.facebook.com/watch/?v=1234567890");

  const reel = provider.detect({
    url: "https://www.facebook.com/reel/987654321/"
  });
  assert.equal(reel?.reason, "facebook_reel");
  assert.equal(reel?.normalizedUrl, "https://www.facebook.com/reel/987654321");
});

test("integration: facebook probe stays blocked by default compliance mode", async () => {
  const provider = createFacebookDownloadProvider();
  const probe = await provider.probe({
    url: "https://fb.watch/abcDEF123/"
  });

  assert.equal(probe.provider, "fb");
  assert.equal(probe.status, "blocked");
  assert.match(probe.reason ?? "", /compliance|licenciamento/i);
});

test("integration: facebook staged flow reaches resolveAsset in prepare-only mode", async () => {
  const videoUrl = "https://video.example.com/test.mp4";
  const mp4Bytes = Buffer.from("00000018667479706D70343200000000", "hex");
  const provider = createFacebookDownloadProvider({
    complianceMode: "prepare_only",
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();

      if (url.includes("graph.facebook.com")) {
        return new Response("", { status: 404 });
      }

      if (url.includes("facebook.com/watch")) {
        return new Response(
          `
            <html>
              <head>
                <meta property="og:url" content="https://www.facebook.com/watch/?v=1234567890" />
                <meta property="og:title" content="Test FB Video" />
                <meta property="og:video:secure_url" content="${videoUrl}" />
              </head>
            </html>
          `,
          {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8"
            }
          }
        );
      }

      if (url === videoUrl && method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": String(mp4Bytes.length)
          }
        });
      }

      if (url === videoUrl && method === "GET") {
        return new Response(mp4Bytes, {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": String(mp4Bytes.length)
          }
        });
      }

      return new Response("", { status: 404 });
    }
  });
  const url = "https://www.facebook.com/watch/?v=1234567890";

  const probe = await provider.probe({ url });
  assert.equal(probe.status, "ready");

  const execution = await provider.downloadWithProbe!({
    probe,
    request: { url }
  });

  assert.equal(execution.provider, "fb");
  assert.equal(execution.status, "ready");
  assert.equal(execution.resultKind, "video_post");
  assert.equal(execution.reason, "download_ready");
  assert.equal(execution.assets.length, 1);
});
