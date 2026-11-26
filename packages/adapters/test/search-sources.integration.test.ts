import assert from "node:assert/strict";
import test from "node:test";
import { Orchestrator, createSearchWithSources, SEARCH_SOURCES_RESPONSE_SCHEMA, type InboundMessageEvent, type WebSearchPort } from "@zappy/core";
import { createOllamaChatAdapter } from "../src/ollama/chat.js";
import { createSearxngWebSearchAdapter } from "../src/search/searxng-web-search-adapter.js";

const official = "https://www.zabbix.com/documentation/current/en/manual/api/reference/event/get";
const noExternalAi = () => assert.fail("legacy AI must not run");
type Options = { admin?: boolean; root?: boolean; identityAdmin?: boolean; natural?: boolean; local?: boolean; consent?: boolean; runtimeIa?: boolean; pages?: boolean; pagesNatural?: boolean };

function setup({ admin = true, root = false, identityAdmin = false, natural = true, local = true, consent = true, runtimeIa = false, pages = false, pagesNatural = false }: Options = {}) {
  const flags: Record<string, string> = {};
  const webModes: string[] = [];
  const calls: URL[] = [];
  const seen = new Set<string>();
  const backend = createSearxngWebSearchAdapter("http://private.test/searxng", async (url) => {
    const endpoint = new URL(String(url));
    calls.push(endpoint);
    assert.equal(endpoint.pathname, "/searxng/search");
    assert.equal(endpoint.searchParams.get("language"), "pt-BR");
    assert.equal(endpoint.searchParams.get("format"), "json");
    return Response.json({ results: [null, { title: "Zabbix API", url: official, content: "A API permite consultar um histórico de eventos filtrado por intervalo de tempo." }] });
  });
  const llm = createOllamaChatAdapter({ baseUrl: "http://ollama.test:11434", model: "qwen3:1.7b", timeoutMs: 5000, format: SEARCH_SOURCES_RESPONSE_SCHEMA }, async (url, init) => {
    const endpoint = new URL(String(url));
    calls.push(endpoint);
    assert.equal(endpoint.origin + endpoint.pathname, "http://ollama.test:11434/api/chat");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "qwen3:1.7b");
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.format, SEARCH_SOURCES_RESPONSE_SCHEMA);
    assert.match(body.messages[1].content, /histórico de eventos/);
    return Response.json({ done: true, message: {
      content: JSON.stringify({ claims: [{ text: "A API permite consultar um histórico de eventos filtrado por intervalo de tempo.", sourceIds: ["F1"], quote: "A API permite consultar um histórico de eventos filtrado por intervalo de tempo." }] })
    } });
  });
  const webSearch: WebSearchPort = { search: async ({ mode }) => {
    webModes.push(mode ?? "");
    return { provider: "fixture", results: [{ title: "Zabbix API", link: official, snippet: "Histórico de eventos" }] };
  } };
  const bot = new Orchestrator({
    flagsRepository: {
      resolveFlags: async () => ({ ...flags }),
      setTenantRuntimeFlag: async ({ key, value }) => { flags[key] = value; }
    },
    triggersRepository: { findActiveByScope: async () => [] },
    messagesRepository: { getRecentMessages: async () => [] },
    consent: {
      getConsent: async ({ tenantId, waUserId }) => ({
        id: "fixture", tenantId, userId: waUserId, createdAt: new Date(), updatedAt: new Date(),
        status: consent ? "ACCEPTED" : "PENDING", termsVersion: "2026-03"
      }),
      setConsentStatus: noExternalAi
    },
    identity: root || identityAdmin ? { getIdentity: async () => ({ role: root ? "ROOT" : "ADMIN", permissions: [] }) } : undefined,
    adminAccess: { isAdmin: async () => admin, add: noExternalAi, remove: noExternalAi, list: noExternalAi },
    rateLimit: { allow: async () => true },
    cooldown: { canFire: async (key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } },
    tasksRepository: {
      addTask: noExternalAi, listTasks: noExternalAi, listTasksForDay: noExternalAi,
      markDone: noExternalAi, countOpen: noExternalAi
    },
    remindersRepository: { createReminder: noExternalAi, listForDay: noExternalAi, countScheduled: noExternalAi },
    prompt: { resolvePrompt: noExternalAi },
    queue: { enqueueReminder: noExternalAi, enqueueTimer: noExternalAi },
    llm: { chat: noExternalAi },
    aiAssistant: { generate: async () => ({ kind: "text", text: "Conversa habitual" }) },
    aiAssistants: runtimeIa ? {
      ollama: { generate: async () => ({ kind: "text", text: "Resposta do serviço Ollama de teste." }) },
      openai: { generate: async () => ({ kind: "text", text: "Resposta do serviço OpenAI de teste." }) }
    } : undefined,
    searchAiProvider: "openai",
    searchAiProviders: {
      openai: { model: "openai-fixture", adapter: { search: async () => ({ provider: "legacy", summary: "Resposta legada.", sources: [] }) } },
      gemini: { model: "gemini-fixture", adapter: { search: async () => { throw new Error("gemini_http_429"); } } }
    },
    webSearch,
    searchWithSources: local ? createSearchWithSources({ backend, llm, model: "qwen3:1.7b" }) : undefined,
    searchSourcesNaturalEnabled: natural,
    searchPages: pages ? createSearchWithSources({ backend, llm: { chat: async () => '{"sourceId":"F1"}' }, model: "qwen3:1.7b",
      pageReader: { read: async ({ url }) => ({ url, paragraphs: ["A API permite consultar um histórico de eventos filtrado por intervalo de tempo."] }) }
    }) : undefined,
    searchPagesNaturalEnabled: pagesNatural
  });
  const send = (text: string, id = "test", overrides: Partial<InboundMessageEvent> = {}) => bot.handleInboundMessage({
    tenantId: "fixture", waUserId: "556699999999@s.whatsapp.net", waMessageId: id,
    executionId: `exec-${id}`, timestamp: new Date(), isGroup: false, text, ...overrides
  });
  return { send, calls, webModes };
}

test("both authorized entries use SearXNG and Ollama exclusively; replay is suppressed", async () => {
  const { send, calls } = setup();
  for (const [id, query] of [["a", "/pesquisar histórico de eventos Zabbix"], ["b", "Pesquise na web sobre histórico de eventos Zabbix"]]) {
    const reply = JSON.stringify(await send(query, id));
    assert.match(reply, /intervalo de tempo\. \[F1\]/);
    assert.ok(reply.includes(official));
    await send(query, id);
  }
  assert.deepEqual(calls.map((url) => url.hostname), ["private.test", "ollama.test", "private.test", "ollama.test"]);
  assert.equal(calls[0].searchParams.get("q"), calls[2].searchParams.get("q"));
});

test("rejects unauthorized direct, group and unconsented traffic without provider calls", async () => {
  const member = setup({ admin: false });
  assert.match(JSON.stringify(await member.send("/pesquisar Zabbix", "a")), /operadores autorizados/);
  assert.match(JSON.stringify(await member.send("Pesquise na web Zabbix", "b")), /operadores autorizados/);
  assert.equal(member.calls.length, 0);
  const group = setup();
  await group.send("/pesquisar Zabbix", "group", { isGroup: true, waGroupId: "test@g.us", isBotMentioned: true });
  assert.equal(group.calls.length, 0);
  const unconsented = setup({ admin: false, consent: false });
  await unconsented.send("Pesquise na web Zabbix", "c");
  assert.equal(unconsented.calls.length, 0);
});

test("retains normal conversation, legacy search-ai and both textual modes", async () => {
  const active = setup({ natural: false });
  assert.match(JSON.stringify(await active.send("Pesquise na web Zabbix?", "a")), /Conversa habitual/);
  assert.equal(active.calls.length, 0);
  await active.send("/search eventos Zabbix", "b");
  await active.send("/google eventos Zabbix", "c");
  assert.deepEqual(active.webModes, ["generic", "google_strict"]);
  assert.equal(active.calls.length, 0);
  const off = setup({ local: false });
  assert.match(JSON.stringify(await off.send("/search-ai histórico do Zabbix")), /Resposta legada/);
  assert.equal(off.calls.length, 0);
});

test("ROOT without the admin-list entry may use both direct search entries", async () => {
  const { send, calls } = setup({ admin: false, root: true });
  assert.match(JSON.stringify(await send("/pesquisar histórico de eventos", "root-a")), /\[F1\]/);
  assert.match(JSON.stringify(await send("Pesquise na web histórico de eventos", "root-b")), /\[F1\]/);
  assert.equal(calls.length, 4);
});

test("uses direct identity ADMIN and suppresses the same WA event across both routes", async () => {
  const { send, calls } = setup({ admin: false, identityAdmin: true });
  assert.match(JSON.stringify(await send("Pesquise na web histórico de eventos", "same")), /\[F1\]/);
  assert.match(JSON.stringify(await send("/pesquisar histórico de eventos", "same")), /search_replay/);
  assert.equal(calls.length, 2);
});

test("distinguishes an upstream failure from an empty SearXNG search", async () => {
  const adapter = createSearxngWebSearchAdapter("http://private.test", async () => Response.json({
    results: [], unresponsive_engines: [["duckduckgo", "CAPTCHA"]]
  }));
  await assert.rejects(adapter.search({ query: "Proxmox", limit: 3 }), /searxng_engines_unavailable/);
  const emptyAdapter = createSearxngWebSearchAdapter("http://private.test", async () => Response.json({
    results: [], unresponsive_engines: []
  }));
  assert.deepEqual(await emptyAdapter.search({ query: "Proxmox", limit: 3 }), { provider: "searxng", results: [] });
});

test("ROOT configures the external provider and switches features per subsequent event", async () => {
  const { send, calls } = setup({ root: true });
  assert.match(JSON.stringify(await send("/configurar provedor-busca gemini", "cfg")), /salva/);
  assert.match(JSON.stringify(await send("/search-ai uma consulta pública", "query")), /Gemini atingiu o limite/);
  assert.match(JSON.stringify(await send("/search-ai", "quote", { quotedWaMessageId: "private", quotedText: "private" })), /consulta pública/);
  assert.equal(calls.length, 0);
  assert.match(JSON.stringify(await send("/configurar pesquisar off", "off")), /salva/);
  assert.match(JSON.stringify(await send("/pesquisar histórico de eventos", "new")), /desligada/);
  assert.equal(calls.length, 0);
  const member = setup({ admin: true });
  assert.match(JSON.stringify(await member.send("/configurar pesquisar off", "no")), /ROOT/);
});

test("hot conversation provider selection uses only the selected adapter when enabled", async () => {
  const { send } = setup({ root: true, runtimeIa: true });
  assert.match(JSON.stringify(await send("/configurar provedor-ia ollama", "provider")), /salva/);
  assert.match(JSON.stringify(await send("Você pode conversar comigo sobre o dia de hoje?", "chat1")), /serviço Ollama/);
  assert.match(JSON.stringify(await send("/configurar ia off", "ia-off")), /salva/);
  assert.doesNotMatch(JSON.stringify(await send("Você pode conversar comigo sobre uma tarde tranquila?", "chat2")), /serviço Ollama/);
});

test("page search uses /search independently of /google and natural search opt-in", async () => {
  const explicit = setup({ pages: true, local: false, natural: false });
  assert.match(JSON.stringify(await explicit.send("/search histórico de eventos Zabbix", "page")), /Trecho da fonte/);
  assert.match(JSON.stringify(await explicit.send("Pesquise na web histórico de eventos", "natural")), /Conversa habitual/);
  await explicit.send("/google histórico de eventos", "exact");
  assert.deepEqual(explicit.webModes, ["google_strict"]);
  assert.equal(explicit.calls.length, 1);

  const both = setup({ pages: true, pagesNatural: true, local: false, natural: false });
  assert.match(JSON.stringify(await both.send("Pesquise na web histórico de eventos", "replay")), /Trecho da fonte/);
  assert.match(JSON.stringify(await both.send("/search histórico de eventos", "replay")), /search_replay/);
  assert.equal(both.calls.length, 1);
});
