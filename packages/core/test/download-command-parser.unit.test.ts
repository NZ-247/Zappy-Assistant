import { strict as assert } from "node:assert";
import test from "node:test";
import { parseDownloadCommand } from "../src/modules/downloads/infrastructure/download-command-parser.js";

test("download parser accepts explicit provider syntax", () => {
  const parsed = parseDownloadCommand("dl ig https://www.instagram.com/reel/abc123/");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.provider, "ig");
  assert.equal(parsed.url, "https://www.instagram.com/reel/abc123/");
});

test("download parser accepts auto-provider syntax with direct url", () => {
  const parsed = parseDownloadCommand("dl https://www.instagram.com/p/xyz789/");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.provider, undefined);
  assert.equal(parsed.url, "https://www.instagram.com/p/xyz789/");
});

test("download parser rejects missing url after explicit provider", () => {
  const parsed = parseDownloadCommand("dl ig");
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "missing_url");
});

test("download parser rejects invalid provider/url token", () => {
  const parsed = parseDownloadCommand("dl nada https://example.com/file.mp4");
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "invalid_provider_or_url");
});
