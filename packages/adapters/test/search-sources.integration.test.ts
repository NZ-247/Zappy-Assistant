import assert from "node:assert/strict";
import test from "node:test";
import { Orchestrator, createSearchWithSources, SEARCH_SOURCES_RESPONSE_SCHEMA, type InboundMessageEvent, type WebSearchPort } from "@zappy/core";
import { createOllamaChatAdapter } from "../src/ollama/chat.js";
import { createSearxngWebSearchAdapter } from "../src/search/searxng-web-search-adapter.js";

const official = "https://www.zabbix.com/documentation/current/en/manual/api/reference/event/get";
const noExternalAi = () => assert.fail("legacy AI must not run");
type Options = { admin?: boolean; root?: boolean; identityAdmin?: boolean; natural?: boolean; local?: boolean; consent?: boolean };

function setup({ admin = true, root = false, identityAdmin = false, natural = true, local = true, consent = true }: Options = {}) {
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
    flagsRepository: { resolveFlags: async () => ({}) },
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
    searchAi: { search: local ? noExternalAi : async () => ({ provider: "legacy", summary: "Resposta legada.", sources: [] }) },
    webSearch,
    searchWithSources: local ? createSearchWithSources({ backend, llm, model: "qwen3:1.7b" }) : undefined,
    searchSourcesNaturalEnabled: natural
  });
  const send = (text: string, id = "test", overrides: Partial<InboundMessageEvent> = {}) => bot.handleInboundMessage({
    tenantId: "fixture", waUserId: "556699999999@s.whatsapp.net", waMessageId: id,
    executionId: `exec-${id}`, timestamp: new Date(), isGroup: false, text, ...overrides
  });
  return { send, calls, webModes };
}

test("both authorized entries use SearXNG and Ollama exclusively; replay is suppressed", async () => {
  const { send, calls } = setup();
  for (const [id, query] of [["a", "/search-ai histórico de eventos Zabbix"], ["b", "Pesquise na web sobre histórico de eventos Zabbix"]]) {
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
  assert.match(JSON.stringify(await member.send("/sai Zabbix", "a")), /operadores autorizados/);
  assert.match(JSON.stringify(await member.send("Pesquise na web Zabbix", "b")), /operadores autorizados/);
  assert.equal(member.calls.length, 0);
  const group = setup();
  await group.send("/sai Zabbix", "group", { isGroup: true, waGroupId: "test@g.us", isBotMentioned: true });
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
  assert.match(JSON.stringify(await send("/sai histórico de eventos", "root-a")), /\[F1\]/);
  assert.match(JSON.stringify(await send("Pesquise na web histórico de eventos", "root-b")), /\[F1\]/);
  assert.equal(calls.length, 4);
});

test("uses direct identity ADMIN and suppresses the same WA event across both routes", async () => {
  const { send, calls } = setup({ admin: false, identityAdmin: true });
  assert.match(JSON.stringify(await send("Pesquise na web histórico de eventos", "same")), /\[F1\]/);
  assert.match(JSON.stringify(await send("/sai histórico de eventos", "same")), /search_replay/);
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
