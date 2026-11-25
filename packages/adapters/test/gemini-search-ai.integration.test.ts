import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createGeminiSearchAiAdapter } from "../src/search/gemini-search-ai-adapter.js";

test("Gemini sends only the query, validates grounded URLs and produces safe failure codes", async (t) => {
  let scenario = "grounded";
  let calls = 0;
  const server = createServer(async (req, res) => {
    calls++;
    let raw = "";
    for await (const part of req) raw += part;
    const payload = JSON.parse(raw);
    assert.deepEqual(payload.contents, [{ role: "user", parts: [{ text: "consulta pública" }] }]);
    assert.deepEqual(payload.tools, [{ google_search: {} }]);
    res.setHeader("content-type", "application/json");
    if (scenario === "quota") {
      res.statusCode = 429;
      res.end(JSON.stringify({ error: { message: "sensitive upstream body" } }));
      return;
    }
    res.end(JSON.stringify({ candidates: [{
      content: { parts: [{ text: "Resumo em português https://inventado.example" }] },
      groundingMetadata: scenario === "grounded" ? { groundingChunks: [
        { web: { uri: "https://docs.nextcloud.com/example", title: "Fonte oficial" } },
        { web: { uri: "javascript:alert(1)", title: "Inválido" } }
      ] } : undefined
    }] }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const adapter = createGeminiSearchAiAdapter({ apiKey: "fixture-key", model: "fixture-model", apiBaseUrl: `http://127.0.0.1:${address.port}` })!;
  assert.deepEqual(await adapter.search({ query: "consulta pública" }), {
    provider: "gemini_google_search", model: "fixture-model", summary: "Resumo em português",
    sources: [{ title: "Fonte oficial", url: "https://docs.nextcloud.com/example" }]
  });
  scenario = "no_grounding";
  await assert.rejects(adapter.search({ query: "consulta pública" }), { message: "gemini_no_grounding" });
  scenario = "quota";
  await assert.rejects(adapter.search({ query: "consulta pública" }), { message: "gemini_http_429" });
  assert.equal(calls, 3);
});
