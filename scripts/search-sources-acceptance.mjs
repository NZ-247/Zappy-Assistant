import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createOllamaChatAdapter, createOllamaSemanticDecisionAdapter, createSearxngWebSearchAdapter } from "@zappy/adapters";
import { createSearchWithSources, SEARCH_SOURCES_RESPONSE_SCHEMA } from "@zappy/core";

const env = process.env;
const ollama = env.OLLAMA_BASE_URL;
const captures = fs.readFileSync(env.SEARCH_CAPTURE, "utf8").trim().split("\n").map(JSON.parse)
  .filter((row) => row.name === "searxng");
const model = env.SEARCH_MODEL ?? "qwen3:1.7b";

const context = new AsyncLocalStorage();
let liveSearch;
function createSearch(model, captured) {
  const backend = captured ? {
    search: async ({ query: requested }) => {
      const results = requested === captured.query ? captured.hits : [];
      context.getStore().retrieval.push({ query: requested, captured: true, count: results.length });
      return { provider: "captured", results };
    }
  } : createSearxngWebSearchAdapter(env.SEARXNG_BASE_URL, async (url, init) => {
    const started = performance.now();
    const event = { query: url.searchParams.get("q") };
    context.getStore().retrieval.push(event);
    try {
      const response = await fetch(url, init);
      event.http = response.status;
      if (response.ok) {
        const json = await response.clone().json();
        event.count = json.results?.length;
        event.unavailable = json.unresponsive_engines;
        event.engines = [...new Set(json.results?.slice(0, 5).flatMap(({ engines }) => engines ?? []) ?? [])];
      }
      return response;
    } catch (error) {
      event.error = init.signal?.aborted ? "timeout" : error.name;
      throw error;
    } finally {
      event.ms = Math.round(performance.now() - started);
    }
  });
  const llm = createOllamaChatAdapter({ baseUrl: ollama, model, timeoutMs: 15_000, format: SEARCH_SOURCES_RESPONSE_SCHEMA }, async (url, init) => {
    context.getStore().evidence = JSON.parse(JSON.parse(init.body).messages[1].content).evidence;
    const response = await fetch(url, init);
    if (response.ok) context.getStore().modelOutput = (await response.clone().json()).message?.content;
    return response;
  });
  return createSearchWithSources({ backend, llm, model, logger: {
    info: (event) => context.getStore().events.push(event), warn: () => {}
  } });
}

function runTurn(id, query, model, captured) {
  const search = captured ? createSearch(model, captured) : (liveSearch ??= createSearch(model));
  const data = { id, query, model, retrieval: [], events: [] };
  return context.run(data, async () => {
    data.answer = await search({ executionId: id, origin: "command", conversationKey: id, query, maxSources: 4 });
    return data;
  });
}

const emit = (data) => console.log(JSON.stringify(data));
if (process.argv.includes("--captured")) {
  for (const candidate of env.SEARCH_MODEL ? [model] : ["qwen3:1.7b", "qwen3:4b"]) {
    for (const record of captures) emit(await runTurn(record.id, record.query, candidate, record));
  }
} else {
  const conversation = createOllamaChatAdapter({ baseUrl: ollama, model: "qwen3:1.7b", timeoutMs: 15_000 });
  const shadow = createOllamaSemanticDecisionAdapter({ baseUrl: ollama, model: "qwen3:1.7b", timeoutMs: 5_000 });
  const background = async () => Promise.allSettled([
    conversation.chat({ system: "Responda em português.", messages: [{ role: "user", content: "Explique em uma frase o que é um backup." }] }),
    shadow.decide("Prepare um relatório do Zabbix das últimas 24 horas")
  ]).then(([chat, observer]) => ({ conversation: chat.status, shadow: observer.status === "fulfilled" ? observer.value.ok : false }));
  for (let batch = 0; batch < 18; batch++) {
    const concurrent = batch % 2 === 1;
    const size = 2;
    const run = (offset) => {
      const index = batch * size + offset;
      const query = captures[index % captures.length].query;
      return runTurn(`turn-${index + 1}`, query, model);
    };
    if (concurrent) {
      const [first, second, load] = await Promise.all([run(0), run(1), background()]);
      for (const turn of [first, second]) emit({ ...turn, concurrent, load, batch: batch + 1 });
    } else {
      for (let offset = 0; offset < size; offset++) emit({ ...await run(offset), concurrent, batch: batch + 1 });
    }
    await delay(batch === 8 ? 45_000 : 8_000);
  }
}
