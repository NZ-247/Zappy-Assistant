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
  const provider = createFacebookDownloadProvider({
    complianceMode: "prepare_only"
  });
  const url = "https://www.facebook.com/watch/?v=1234567890";

  const probe = await provider.probe({ url });
  assert.equal(probe.status, "ready");

  const execution = await provider.downloadWithProbe!({
    probe,
    request: { url }
  });

  assert.equal(execution.provider, "fb");
  assert.equal(execution.status, "unsupported");
  assert.equal(execution.reason, "facebook_resolve_asset_not_implemented");
  assert.equal(execution.assets.length, 0);
});
