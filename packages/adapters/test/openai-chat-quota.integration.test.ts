import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createOpenAiAdapter } from "../src/index.js";

test("OpenAI chat classifies insufficient quota without retrying the failing provider", async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(429, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "test quota exhausted", code: "insufficient_quota" } }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const previous = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previous;
  });

  const llm = createOpenAiAdapter("test-key", "test-model");
  await assert.rejects(llm.chat({ system: "system", messages: [{ role: "user", content: "test" }] }), {
    name: "LlmError", reason: "insufficient_quota", status: 429
  });
  assert.equal(requests, 1);
});
