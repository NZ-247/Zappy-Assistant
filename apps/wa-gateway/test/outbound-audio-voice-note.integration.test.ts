import { strict as assert } from "node:assert";
import test from "node:test";
import { executeOutboundActions } from "../src/infrastructure/outbound-actions.js";
import { CANONICAL_VOICE_NOTE_PIPELINE_ID, WHATSAPP_VOICE_NOTE_MIME_TYPE } from "../src/infrastructure/outbound/handlers/wa-audio-send-pipeline.js";

type CapturedLog = { level: "info" | "warn" | "debug"; payload: any; message?: string };

const buildRuntime = (input: { action: any; sentPayloads: any[]; logs: CapturedLog[] }): any => ({
  actions: [input.action],
  isGroup: false,
  remoteJid: "556699999999@s.whatsapp.net",
  waUserId: "556699999999@s.whatsapp.net",
  event: {
    tenantId: "tenant_test",
    waGroupId: undefined,
    waUserId: "556699999999@s.whatsapp.net",
    waMessageId: "wamid.voice-note.test",
    executionId: "exec.voice-note.test"
  },
  message: {
    key: {
      id: "wamid.voice-note.test",
      remoteJid: "556699999999@s.whatsapp.net",
      fromMe: false
    }
  },
  context: {
    tenant: { id: "tenant_test" },
    user: { id: "user_test" },
    group: undefined
  },
  contextInfo: undefined,
  commandPrefix: "/",
  progressReactions: { enabled: true, processingEmoji: "⏳", successEmoji: "✅", failureEmoji: "❌" },
  audioConfig: {
    enabled: false,
    sttModel: "none",
    sttTimeoutMs: 1_000,
    maxDurationSeconds: 120,
    maxBytes: 1024 * 1024,
    commandDispatchEnabled: false,
    commandPrefix: "/",
    commandAllowlist: [],
    commandMinConfidence: 0.8,
    transcriptPreviewChars: 120
  },
  dispatchTranscribedText: async () => ({ hadResponses: false }),
  sendWithReplyFallback: async ({ content }: { content: any }) => {
    input.sentPayloads.push(content);
    return { key: { id: `msg_${input.sentPayloads.length}` } };
  },
  persistOutboundMessage: async () => ({ ok: true }),
  queueAdapter: {
    enqueueReminder: async () => ({ ok: true }),
    enqueueTimer: async () => ({ ok: true })
  },
  groupAccessRepository: {
    getGroupAccess: async () => ({}),
    updateSettings: async () => ({})
  },
  muteAdapter: {
    mute: async () => ({ until: new Date() }),
    unmute: async () => {}
  },
  attemptGroupAdminAction: async () => ({ kind: "ok" }),
  getSocket: () => null,
  downloadMediaMessage: async () => Buffer.alloc(0),
  baileysLogger: {},
  normalizeJid: (value: string) => value,
  logger: {
    debug: (payload: any, message?: string) => input.logs.push({ level: "debug", payload, message }),
    info: (payload: any, message?: string) => input.logs.push({ level: "info", payload, message }),
    warn: (payload: any, message?: string) => input.logs.push({ level: "warn", payload, message })
  },
  withCategory: (_category: unknown, payload?: Record<string, unknown>) => payload ?? {},
  metrics: { increment: async () => {} },
  auditTrail: { record: async () => {} },
  stickerMaxVideoSeconds: 10
});

test("reply_audio from /tts is always delivered through canonical voice-note payload", async () => {
  const sentPayloads: any[] = [];
  const logs: CapturedLog[] = [];
  const runtime = buildRuntime({
    action: {
      kind: "reply_audio",
      audioBase64: Buffer.concat([Buffer.from("OggS"), Buffer.alloc(512, 1)]).toString("base64"),
      mimeType: WHATSAPP_VOICE_NOTE_MIME_TYPE,
      ptt: false,
      capability: "tts"
    },
    sentPayloads,
    logs
  });

  await executeOutboundActions(runtime);

  assert.equal(sentPayloads.length, 1);
  assert.ok(Buffer.isBuffer(sentPayloads[0]?.audio));
  assert.equal(sentPayloads[0]?.mimetype, WHATSAPP_VOICE_NOTE_MIME_TYPE);
  assert.equal(sentPayloads[0]?.ptt, true);

  const successLog = logs.find((entry) => entry.level === "info" && entry.payload?.action === "send_ptt" && entry.payload?.status === "success");
  assert.ok(successLog);
  assert.equal(successLog?.payload?.sourceFlow, "tts");
  assert.equal(successLog?.payload?.canonicalNormalizationUsed, true);
  assert.equal(successLog?.payload?.canonicalPipeline, CANONICAL_VOICE_NOTE_PIPELINE_ID);
});

test("generic assistant reply_audio is forced to voice-note semantics", async () => {
  const sentPayloads: any[] = [];
  const logs: CapturedLog[] = [];
  const runtime = buildRuntime({
    action: {
      kind: "reply_audio",
      audioBase64: Buffer.concat([Buffer.from("OggS"), Buffer.alloc(384, 2)]).toString("base64"),
      mimeType: WHATSAPP_VOICE_NOTE_MIME_TYPE,
      ptt: false
    },
    sentPayloads,
    logs
  });

  await executeOutboundActions(runtime);

  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0]?.ptt, true);
  assert.equal(sentPayloads[0]?.mimetype, WHATSAPP_VOICE_NOTE_MIME_TYPE);

  const successLog = logs.find((entry) => entry.level === "info" && entry.payload?.action === "send_ptt" && entry.payload?.status === "success");
  assert.ok(successLog);
  assert.equal(successLog?.payload?.sourceFlow, "assistant_audio");
});

test("reply_audio normalization failure does not fallback to generic audio payload", async () => {
  const sentPayloads: any[] = [];
  const logs: CapturedLog[] = [];
  const runtime = buildRuntime({
    action: {
      kind: "reply_audio",
      audioBase64: Buffer.from("definitely-not-a-valid-audio-container").toString("base64"),
      mimeType: "audio/mpeg",
      ptt: true,
      capability: "tts"
    },
    sentPayloads,
    logs
  });

  await executeOutboundActions(runtime);

  assert.equal(sentPayloads.length, 1);
  assert.equal(typeof sentPayloads[0]?.text, "string");
  assert.match(sentPayloads[0]?.text, /normalizar.*voice note/i);
  assert.equal(Boolean(sentPayloads[0]?.audio), false);

  const failureLog = logs.find((entry) => entry.level === "warn" && entry.payload?.action === "send_ptt" && entry.payload?.status === "failure");
  assert.ok(failureLog);
  assert.equal(failureLog?.payload?.canonicalNormalizationUsed, true);
});
