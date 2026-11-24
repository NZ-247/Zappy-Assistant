import assert from "node:assert/strict";
import { setImmediate, setTimeout as wait } from "node:timers/promises";
import test from "node:test";
import { LlmError, Orchestrator, type InboundMessageEvent } from "@zappy/core";
import { createOllamaSemanticDecisionAdapter } from "../src/ollama/semantic-decision.js";

const report = "Gere um relatório do Zabbix das últimas 24 horas";
const proposal = { kind: "propose", tool: "zabbix_report", hours: 24 };
const normalReply = [{ kind: "reply_text", text: "Resposta habitual" }];
const ollamaResponse = (decision: unknown) => Response.json({
  done: true, message: { content: JSON.stringify(decision) }
});

function setup(options: {
  enabled?: boolean;
  authorized?: boolean;
  consented?: boolean;
  exhaustedOpenAi?: boolean;
  timeoutMs?: number;
  request?: typeof fetch;
} = {}) {
  const logs: Record<string, unknown>[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  const seen = new Set<string>();
  let fallbackCalls = 0;

  const record = (fields: unknown) => {
    const entry = fields as Record<string, unknown>;
    if (entry.category === "SEMANTIC_SHADOW") logs.push(entry);
  };
  const unexpectedTool = () => assert.fail("tool was invoked");
  const orchestrator = new Orchestrator({
    flagsRepository: { resolveFlags: async () => ({}) },
    triggersRepository: { findActiveByScope: async () => [] },
    messagesRepository: { getRecentMessages: async () => [] },
    consent: {
      getConsent: async ({ tenantId, waUserId }) => ({
        id: "consent", tenantId, userId: waUserId, createdAt: new Date(), updatedAt: new Date(),
        status: options.consented === false ? "PENDING" : "ACCEPTED",
        termsVersion: "2026-03"
      }),
      setConsentStatus: unexpectedTool
    },
    adminAccess: { isAdmin: async () => options.authorized !== false, add: unexpectedTool, remove: unexpectedTool, list: unexpectedTool },
    rateLimit: { allow: async () => true },
    cooldown: {
      canFire: async (key: string) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }
    },
    tasksRepository: {
      addTask: unexpectedTool,
      listTasks: unexpectedTool,
      listTasksForDay: unexpectedTool,
      markDone: unexpectedTool,
      countOpen: unexpectedTool
    },
    remindersRepository: {
      createReminder: unexpectedTool, listForDay: unexpectedTool, countScheduled: unexpectedTool
    },
    prompt: { resolvePrompt: unexpectedTool },
    queue: { enqueueReminder: unexpectedTool, enqueueTimer: unexpectedTool },
    llm: { chat: unexpectedTool },
    aiAssistant: {
      generate: async () => {
        fallbackCalls++;
        if (options.exhaustedOpenAi) throw new LlmError("insufficient_quota", "test quota exhausted", { status: 429 });
        return { kind: "text", text: "Resposta habitual" };
      }
    },
    logger: { info: record, warn: record },
    semanticDecision: options.enabled === false ? undefined : createOllamaSemanticDecisionAdapter({
      baseUrl: "http://ollama.internal:11434",
      model: "qwen3:1.7b",
      timeoutMs: options.timeoutMs ?? 5000
    }, async (url, init) => {
      requests.push({ url: String(url), init });
      return options.request ? options.request(url, init) : ollamaResponse(proposal);
    })
  });

  const send = (text: string, id = "1", overrides: Partial<InboundMessageEvent> = {}) =>
    orchestrator.handleInboundMessage({
      tenantId: "test", waUserId: "556699999999@s.whatsapp.net", waMessageId: id,
      executionId: `execution-${id}`, timestamp: new Date(), isGroup: false, text, ...overrides
    });

  return { send, logs, requests, fallbackCalls: () => fallbackCalls };
}

test("the disabled flag leaves the normal reply and sends no requests", async () => {
  const bot = setup({ enabled: false });
  assert.deepEqual(await bot.send(report), normalReply);
  assert.deepEqual(bot.requests, []);
  assert.deepEqual(bot.logs, []);
});

test("commands, unknown commands and group messages never reach the observer", async () => {
  const bot = setup();
  assert.match(JSON.stringify(await bot.send("/ping")), /pong/i);
  assert.match(JSON.stringify(await bot.send("/zabbix")), /desconhecido/i);
  await bot.send(report, "group", { isGroup: true, waGroupId: "test@g.us", isBotMentioned: true });
  assert.deepEqual(bot.requests, []);
});

test("an unauthorized direct message follows the normal flow without a local inference", async () => {
  const bot = setup({ authorized: false });
  assert.deepEqual(await bot.send(report), normalReply);
  assert.deepEqual(bot.requests, []);
});

test("consent and deterministic natural-language handlers take precedence", async () => {
  const withoutConsent = setup({ consented: false });
  assert.match(JSON.stringify(await withoutConsent.send(report)), /políticas|termos|consentimento/i);
  assert.deepEqual(withoutConsent.requests, []);

  const bot = setup();
  assert.equal((await bot.send("Que horas são?"))[0]?.kind, "reply_text");
  assert.equal(bot.fallbackCalls(), 0);
  assert.deepEqual(bot.requests, []);
});

test("duplicates are discarded before the observer", async () => {
  const bot = setup();
  await bot.send(report);
  await setImmediate();
  assert.deepEqual(await bot.send(report, "duplicate"), [{ kind: "noop", reason: "duplicate" }]);
  assert.equal(bot.requests.length, 1);
});

for (const [message, decision] of [
  [report, proposal],
  ["Relatório do Zabbix dos últimos dois dias", { ...proposal, hours: 48 }],
  ["Gere um relatório do Zabbix", { kind: "clarify" }],
  ["Qual é a previsão do tempo?", { kind: "unsupported" }]
] as const) {
  test(`logs the validated model decision for "${message}" without changing the reply`, async () => {
    const bot = setup({ request: async () => ollamaResponse(decision) });
    assert.deepEqual(await bot.send(message), normalReply);
    await setImmediate();

    assert.equal(bot.fallbackCalls(), 1);
    assert.equal(bot.requests.length, 1);
    const [{ url, init }] = bot.requests;
    assert.equal(url, "http://ollama.internal:11434/api/chat");
    assert.equal(init?.method, "POST");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, "qwen3:1.7b");
    assert.equal(payload.stream, false);
    assert.equal(payload.think, false);
    assert.deepEqual(payload.options, { num_ctx: 2048, temperature: 0, num_predict: 80 });
    assert.deepEqual(payload.messages[1], { role: "user", content: message });
    assert.match(payload.messages[0].content, /últimos dois dias.*"hours":48/);
    assert.ok(payload.format);
    assert.equal(payload.tools, undefined);

    assert.equal(bot.logs.length, 1);
    const [log] = bot.logs;
    assert.equal(log.correlationId, "execution-1");
    assert.equal(log.model, "qwen3:1.7b");
    assert.equal(log.status, "ok");
    assert.equal(typeof log.latencyMs, "number");
    assert.deepEqual(log.decision, decision);
    assert.ok(!JSON.stringify(log).includes(message));
  });
}

for (const invalid of [
  { ...proposal, hours: 0 },
  { ...proposal, hours: 1.5 },
  { ...proposal, hours: "24" },
  { ...proposal, hours: 169 },
  { ...proposal, tool: "other" },
  { ...proposal, extra: "private model output" },
  { kind: "clarify", hours: 24 }
]) {
  test(`rejects invalid model output ${JSON.stringify(invalid)}`, async () => {
    const bot = setup({ request: async () => ollamaResponse(invalid) });
    assert.deepEqual(await bot.send(report), normalReply);
    await setImmediate();
    assert.equal(bot.fallbackCalls(), 1);
    assert.equal(bot.logs[0]?.reason, "invalid_response");
    assert.equal(bot.logs[0]?.decision, undefined);
    assert.ok(!JSON.stringify(bot.logs).includes("private model output"));
  });
}

test("invalid JSON and HTTP errors preserve the normal fallback and omit the raw body", async () => {
  for (const [response, reason] of [
    [Response.json({ done: true, message: { content: "private model output" } }), "invalid_response"],
    [new Response("private HTTP body", { status: 503 }), "http_error"]
  ] as const) {
    const bot = setup({ request: async () => response });
    assert.deepEqual(await bot.send(report), normalReply);
    await setImmediate();
    assert.equal(bot.fallbackCalls(), 1);
    assert.equal(bot.logs[0]?.reason, reason);
    if (reason === "http_error") assert.equal(bot.logs[0]?.httpStatus, 503);
    assert.ok(!JSON.stringify(bot.logs).includes("private"));
  }
});

test("timeout aborts local inference and releases the slot without retrying the fallback", async () => {
  const bot = setup({
    timeoutMs: 10,
    request: async (_url, init) => {
      assert.ok(init?.signal);
      await wait(1000, undefined, { signal: init.signal });
      assert.fail("inference should have been aborted");
    }
  });
  assert.deepEqual(await bot.send(report), normalReply);
  await wait(30);
  assert.equal(bot.logs[0]?.reason, "timeout");
  assert.equal(bot.fallbackCalls(), 1);
  assert.deepEqual(await bot.send("Quero outro relatório do Zabbix", "2"), normalReply);
  assert.equal(bot.requests.length, 2);
  await wait(30);
});

test("a pending inference does not hold the reply and concurrent samples are discarded", { timeout: 1000 }, async () => {
  let release!: (value: Response) => void;
  const response = new Promise<Response>((resolve) => { release = resolve; });
  const bot = setup({ request: async () => response });
  try {
    assert.deepEqual(await bot.send(report), normalReply);
    assert.deepEqual(await bot.send("Gere um relatório do Zabbix", "2"), normalReply);
    assert.equal(bot.requests.length, 1);
    assert.equal(bot.fallbackCalls(), 2);
    assert.deepEqual(bot.logs.map(({ correlationId, reason }) => ({ correlationId, reason })), [
      { correlationId: "execution-2", reason: "busy" }
    ]);
  } finally {
    release(ollamaResponse(proposal));
  }
  await setImmediate();
  assert.deepEqual(bot.logs[1]?.decision, proposal);
});


test("OpenAI quota failure degrades to the normal unavailable reply independently of the shadow decision", async () => {
  const bot = setup({ exhaustedOpenAi: true });
  const actions = await bot.send(report);
  assert.equal(actions[0]?.kind, "reply_text");
  assert.match(JSON.stringify(actions), /sem acesso ao assistente inteligente/);
  await setImmediate();
  assert.equal(bot.fallbackCalls(), 1);
  assert.deepEqual(bot.logs[0]?.decision, proposal);
});
