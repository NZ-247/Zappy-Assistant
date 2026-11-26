import { createOllamaChatAdapter, createPublicPageReader, createWebSearchAdapter } from "@zappy/adapters";
import { createSearchWithSources, SEARCH_PAGE_RESPONSE_SCHEMA } from "@zappy/core";

const queries = [
  ["proxmox", "Proxmox VE documentação backup vzdump restauração", [
    "https://pve.proxmox.com/pve-docs/chapter-vzdump.html",
    "https://pulseit.novaorbit.com.br/proxmox-ve-backup-automatico-vzdump-retencao/"
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
  const events = [];
  const backend = pinned ? {
    search: async () => ({ provider: "known-public-urls", results: urls.map((link) => ({ title: new URL(link).hostname, link })) })
  } : discovery;
  const search = createSearchWithSources({
    backend, pageReader, llm, model, logger: { info: (event) => events.push(event), warn: () => {} }
  });
  const answer = await search({ query, executionId: id, conversationKey: id, origin: "command", maxSources: 3 });
  console.log(JSON.stringify({ id, query, mode: pinned ? "known-public-urls" : "duckduckgo", answer, events }));
}
