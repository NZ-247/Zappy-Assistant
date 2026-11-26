import { createOllamaChatAdapter, createPublicPageReader, createWebSearchAdapter } from "@zappy/adapters";
import { createSearchWithSources, SEARCH_PAGE_RESPONSE_SCHEMA } from "@zappy/core";

const queries = [
  ["proxmox", "Proxmox VE documentação backup vzdump restauração", [
    "https://pve.proxmox.com/pve-docs/chapter-vzdump.html",
    "https://pulseit.novaorbit.com.br/proxmox-ve-backup-automatico-vzdump-retencao/",
    "https://pve.proxmox.com/pve-docs/qmrestore.1.html"
  ]],
  ["nextcloud", "Nextcloud configurar cron local tarefas em segundo plano", [
    "https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/background_jobs_configuration.html"
  ]],
  ["zabbix", "Zabbix histórico de problemas resolvidos event.get", [
    "https://www.zabbix.com/documentation/6.4/pt/manual/api/reference/problem/get",
    "https://www.zabbix.com/documentation/current/en/manual/api/reference/event/get"
  ]]
];
const discovery = createWebSearchAdapter({ preferredProvider: "duckduckgo", timeoutMs: 3500 });
const pageReader = createPublicPageReader();
const model = process.env.SEARCH_PAGES_MODEL ?? "qwen3:1.7b";
const llm = createOllamaChatAdapter({
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  model, timeoutMs: 15_000, format: SEARCH_PAGE_RESPONSE_SCHEMA
});
const pinned = process.argv.includes("--known-urls");
for (const [id, query, urls] of queries) {
  const events = [], discoveries = [], reads = [];
  const backend = pinned ? {
    search: async () => ({ provider: "known-public-urls", results: urls.map((link) => ({ title: new URL(link).hostname, link })) })
  } : discovery;
  const search = createSearchWithSources({
    backend: { async search(input) {
      const result = await backend.search(input);
      discoveries.push({ query: input.query, urls: result.results.map(row => row.link) });
      return result;
    } },
    pageReader: { async read(input) {
      const started = performance.now();
      try {
        const page = await pageReader.read(input);
        reads.push({ url: page.url, ms: Math.round(performance.now()-started), paragraphs: page.paragraphs.length });
        return page;
      } catch(error) {
        reads.push({ url: input.url, ms: Math.round(performance.now()-started), reason: error.name, detail: error.message });
        throw error;
      }
    } },
    llm, model, logger: { info: (event) => events.push(event), warn: () => {} }
  });
  const answer = await search({ query, executionId: id, conversationKey: id, origin: "command", maxSources: 3 });
  console.log(JSON.stringify({ id, query, mode: pinned ? "known-public-urls" : "duckduckgo", answer, discoveries, reads, events }));
}
