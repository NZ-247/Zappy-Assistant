import { setTimeout as delay } from "node:timers/promises";
import { createSearxngWebSearchAdapter, createWebSearchAdapter } from "@zappy/adapters";

const queries = [
  ["PVE", "Proxmox VE documentação oficial backup vzdump e restauração", /^(pve\.)?proxmox\.com$/i],
  ["NC", "Nextcloud documentação oficial configuração cron tarefas em segundo plano", /^(docs\.)?nextcloud\.com$/i],
  ["ZBX", "Zabbix documentação oficial API problem.get event.get histórico de problemas", /^(www\.)?zabbix\.com$/i]
];
const [rounds = 10, pause = 1000] = process.argv.slice(2).map(Number);
const baseUrl = process.env.SEARXNG_BASE_URL;
if (!baseUrl || !Number.isInteger(rounds) || rounds < 1 || rounds > 30 || !Number.isInteger(pause) || pause < 0) {
  throw new Error("Usage: set SEARXNG_BASE_URL and run node scripts/search-sources-benchmark.mjs [rounds 1–30] [pause-ms]");
}
const endpoint = new URL(baseUrl);
if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
  throw new Error("SEARXNG_BASE_URL must be HTTP(S) without credentials, query or fragment");
}
const existing = createWebSearchAdapter({
  googleApiKey: process.env.GOOGLE_SEARCH_API_KEY,
  googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
  googleCx: process.env.GOOGLE_SEARCH_CX,
  preferredProvider: process.env.SEARCH_PROVIDER === "duckduckgo" ? "duckduckgo" : "google"
});
let engineDiagnostics;
const engineNames = (items) => Array.isArray(items)
  ? items.filter((name) => typeof name === "string" && /^[\w -]{1,50}$/.test(name))
  : [];
const searxng = createSearxngWebSearchAdapter(baseUrl, async (url, init) => {
  const response = await fetch(url, init);
  if (response.ok) {
    const data = await response.clone().json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const unavailable = Array.isArray(data?.unresponsive_engines) ? data.unresponsive_engines : [];
    engineDiagnostics = {
      engines: [...new Set(results.slice(0, 3).flatMap((item) => engineNames(item?.engines)))],
      unavailableEngines: engineNames(unavailable.map((item) => Array.isArray(item) ? item[0] : undefined))
    };
  }
  return response;
});

function reportHit(item, official) {
  let url;
  try { url = new URL(item.link); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  return { url: url.origin + url.pathname, official: official.test(url.hostname), snippetChars: item.snippet?.length ?? 0 };
}

async function measure([id, query, official], backend, round) {
  const start = performance.now();
  const signal = AbortSignal.timeout(5_000);
  engineDiagnostics = undefined;
  try {
    const adapter = backend === "searxng" ? searxng : existing;
    const result = await adapter.search({ query, limit: 3, mode: backend === "google-strict" ? "google_strict" : "generic", locale: "pt-BR", signal });
    return {
      id, round, backend, latencyMs: Math.round(performance.now() - start),
      provider: result.provider, fallback: result.fallbackReason, ...engineDiagnostics,
      hits: result.results.map((item) => reportHit(item, official)).filter(Boolean)
    };
  } catch (error) {
    const code = error instanceof Error && /^(?:http|searxng_http)_\d{3}$/.test(error.message) ? error.message : "backend_error";
    return { id, round, backend, latencyMs: Math.round(performance.now() - start), error: signal.aborted ? "timeout" : code };
  }
}

const samples = [];
for (let index = 0; index < rounds; index++) {
  for (const query of queries) {
    const ordered = index % 2 === 0 ? ["existing", "searxng"] : ["searxng", "existing"];
    for (const backend of ordered) {
      const sample = await measure(query, backend, index + 1);
      samples.push(sample);
      console.log(JSON.stringify({ type: "sample", ...sample }));
      await delay(pause);
    }
  }
}
for (const query of queries) {
  console.log(JSON.stringify({ type: "sample", ...await measure(query, "google-strict", 1) }));
  await delay(pause);
}
const percentile = (ordered, p) => ordered[Math.ceil(ordered.length * p) - 1];
for (const backend of ["existing", "searxng"]) {
  const group = samples.filter((sample) => sample.backend === backend);
  const times = group.map(({ latencyMs }) => latencyMs).sort((a, b) => a - b);
  console.log(JSON.stringify({
    type: "summary", backend, n: group.length, p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95),
    failure: group.filter((sample) => sample.error).length,
    empty: group.filter((sample) => sample.hits?.length === 0).length,
    withOfficial: group.filter((sample) => sample.hits?.some((hit) => hit.official)).length,
    withSnippet: group.filter((sample) => sample.hits?.some((hit) => hit.snippetChars >= 25)).length
  }));
}
