import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { LlmError, type ConversationMessage } from "@zappy/core";
import { createOllamaChatAdapter } from "../src/ollama/chat.js";

const system = "Responda em português.";
const messages: ConversationMessage[] = [
  { role: "user", content: "O nome do roteador é Ipê-47." },
  { role: "assistant", content: "Entendido." },
  { role: "user", content: "Qual é o nome do roteador?" }
];
const config = { baseUrl: "http://ollama.test:11434", model: "qwen3:1.7b", timeoutMs: 1000 };

test("Ollama chat passes persona and ordered history without advertising tools", async () => {
  const adapter = createOllamaChatAdapter(config, async (url, init) => {
    assert.equal(String(url), "http://ollama.test:11434/api/chat");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "manual");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: config.model, stream: false, think: false,
      options: { num_ctx: 2048, temperature: 0, num_predict: 256 },
      messages: [{ role: "system", content: system }, ...messages]
    });
    return Response.json({ done: true, done_reason: "stop", message: { content: " O nome é Ipê-47. " } });
  });
  assert.equal(await adapter.chat({ system, messages }), "O nome é Ipê-47.");
});

test("Ollama chat normalizes unavailable, rate-limited, invalid and incomplete responses", async () => {
  for (const [response, reason] of [
    [new Response("private details", { status: 503 }), "network"],
    [new Response("private details", { status: 429 }), "rate_limit"],
    [new Response("not JSON"), "unknown"],
    [Response.json({ done: true, done_reason: "length", message: { content: "partial output" } }), "unknown"],
    [Response.json({ done: true, message: { tool_calls: [{ function: { name: "zabbix_report" } }] } }), "unknown"]
  ] as const) {
    const adapter = createOllamaChatAdapter(config, async () => response);
    await assert.rejects(adapter.chat({ system, messages }), (error: unknown) => {
      assert.ok(error instanceof LlmError);
      assert.equal(error.reason, reason);
      assert.doesNotMatch(error.message, /private|partial output/);
      return true;
    });
  }
});

test("Ollama chat aborts on timeout and does not switch providers", async () => {
  let calls = 0;
  const adapter = createOllamaChatAdapter({ ...config, timeoutMs: 10 }, async (_url, init) => {
    calls++;
    await delay(1000, undefined, { signal: init?.signal ?? undefined });
    assert.fail("the HTTP request should be aborted");
  });
  await assert.rejects(adapter.chat({ system, messages }), { name: "LlmError", reason: "timeout" });
  assert.equal(calls, 1);
});
