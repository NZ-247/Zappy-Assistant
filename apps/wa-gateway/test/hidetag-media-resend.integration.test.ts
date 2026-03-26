import { strict as assert } from "node:assert";
import test from "node:test";
import { executeOutboundActions } from "../src/infrastructure/outbound-actions.js";

const buildBaseRuntime = (input: {
  action: any;
  quotedMessage: any;
  sentPayloads: any[];
  downloadCalls: any[];
  downloadedMediaBuffer?: Buffer;
  logs?: Array<{ level: "info" | "warn" | "debug"; payload: any; message?: string }>;
}) => ({
  actions: [input.action],
  isGroup: true,
  remoteJid: "120363012345678@g.us",
  waUserId: "556699999999@s.whatsapp.net",
  event: {
    tenantId: "tenant_test",
    waGroupId: "120363012345678@g.us",
    waUserId: "556699999999@s.whatsapp.net",
    waMessageId: "wamid.hidetag.test",
    executionId: "exec.hidetag.test",
    quotedWaMessageId: "quoted-media-1",
    quotedWaUserId: "556688888888@s.whatsapp.net"
  },
  message: {
    key: {
      id: "wamid.hidetag.test",
      remoteJid: "120363012345678@g.us",
      fromMe: false,
      participant: "556699999999@s.whatsapp.net"
    }
  },
  context: {
    tenant: { id: "tenant_test" },
    user: { id: "user_test" },
    group: { id: "group_test", name: "Grupo Teste" }
  },
  contextInfo: {
    quotedMessage: input.quotedMessage
  },
  quotedWaMessageId: "quoted-media-1",
  quotedWaUserId: "556688888888@s.whatsapp.net",
  commandPrefix: "/",
  progressReactions: { enabled: true, processingEmoji: "⏳", successEmoji: "✅", failureEmoji: "❌" },
  audioConfig: {
    enabled: true,
    sttModel: "gpt-4o-mini-transcribe",
    sttTimeoutMs: 10_000,
    maxDurationSeconds: 120,
    maxBytes: 2 * 1024 * 1024,
    commandDispatchEnabled: true,
    commandPrefix: "/",
    commandAllowlist: ["trl"],
    commandMinConfidence: 0.8,
    transcriptPreviewChars: 120
  },
  speechToText: undefined,
  dispatchTranscribedText: async () => ({ hadResponses: false }),
  sendWithReplyFallback: async ({ content }: { content: any }) => {
    input.sentPayloads.push(content);
    return { key: { id: `out-${input.sentPayloads.length}` } };
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
  attemptGroupAdminAction: async () => ({ kind: "success" }),
  getSocket: () => ({
    groupMetadata: async () => ({
      participants: [{ id: "111@s.whatsapp.net" }, { id: "222@s.whatsapp.net" }]
    }),
    updateMediaMessage: async () => ({ ok: true })
  }),
  downloadMediaMessage: async (payload: any) => {
    input.downloadCalls.push(payload);
    return input.downloadedMediaBuffer ?? Buffer.from([9, 8, 7, 6]);
  },
  baileysLogger: {},
  normalizeJid: (value: string) => value,
  logger: {
    debug: (payload: any, message?: string) => {
      input.logs?.push({ level: "debug", payload, message });
    },
    info: (payload: any, message?: string) => {
      input.logs?.push({ level: "info", payload, message });
    },
    warn: (payload: any, message?: string) => {
      input.logs?.push({ level: "warn", payload, message });
    }
  },
  withCategory: (_category: unknown, payload?: Record<string, unknown>) => payload ?? {},
  metrics: { increment: async () => {} },
  auditTrail: { record: async () => {} },
  stickerMaxVideoSeconds: 10
});

test("hidetag replied sticker is resent as bot-originated sticker with hidden mentions", async () => {
  const sentPayloads: any[] = [];
  const downloadCalls: any[] = [];

  const runtime: any = buildBaseRuntime({
    action: {
      kind: "moderation_action",
      action: "hidetag",
      waGroupId: "120363012345678@g.us",
      hidetagContent: { kind: "reply_sticker" }
    },
    quotedMessage: {
      stickerMessage: {
        mimetype: "image/webp"
      }
    },
    sentPayloads,
    downloadCalls
  });

  await executeOutboundActions(runtime);

  assert.equal(downloadCalls.length, 1);
  assert.equal(sentPayloads.length, 1);
  assert.ok(Buffer.isBuffer(sentPayloads[0]?.sticker));
  assert.deepEqual(sentPayloads[0]?.contextInfo?.mentionedJid, ["111@s.whatsapp.net", "222@s.whatsapp.net"]);
});

test("hidetag replied ptt audio is resent as bot-originated voice note with hidden mentions", async () => {
  const sentPayloads: any[] = [];
  const downloadCalls: any[] = [];

  const runtime: any = buildBaseRuntime({
    action: {
      kind: "moderation_action",
      action: "hidetag",
      waGroupId: "120363012345678@g.us",
      hidetagContent: { kind: "reply_ptt" }
    },
    quotedMessage: {
      audioMessage: {
        mimetype: "audio/ogg; codecs=opus",
        ptt: true
      }
    },
    sentPayloads,
    downloadCalls,
    downloadedMediaBuffer: Buffer.concat([Buffer.from("OggS"), Buffer.alloc(512, 1)])
  });

  await executeOutboundActions(runtime);

  assert.equal(downloadCalls.length, 1);
  assert.equal(sentPayloads.length, 1);
  assert.ok(Buffer.isBuffer(sentPayloads[0]?.audio));
  assert.equal(sentPayloads[0]?.ptt, true);
  assert.equal(sentPayloads[0]?.mimetype, "audio/ogg; codecs=opus");
  assert.deepEqual(sentPayloads[0]?.contextInfo?.mentionedJid, ["111@s.whatsapp.net", "222@s.whatsapp.net"]);
});

test("hidetag replied ptt falls back to regular audio when ptt normalization fails", async () => {
  const sentPayloads: any[] = [];
  const downloadCalls: any[] = [];
  const logs: Array<{ level: "info" | "warn" | "debug"; payload: any; message?: string }> = [];

  const runtime: any = buildBaseRuntime({
    action: {
      kind: "moderation_action",
      action: "hidetag",
      waGroupId: "120363012345678@g.us",
      hidetagContent: { kind: "reply_ptt" }
    },
    quotedMessage: {
      audioMessage: {
        mimetype: "audio/mpeg",
        ptt: false
      }
    },
    sentPayloads,
    downloadCalls,
    logs
  });

  await executeOutboundActions(runtime);

  assert.equal(downloadCalls.length, 1);
  assert.equal(sentPayloads.length, 1);
  assert.ok(Buffer.isBuffer(sentPayloads[0]?.audio));
  assert.equal(sentPayloads[0]?.ptt, false);
  assert.equal(sentPayloads[0]?.mimetype, "audio/mpeg");
  assert.ok(
    logs.some(
      (entry) => entry.level === "warn" && entry.payload?.status === "hidetag_ptt_transcode_fallback"
    )
  );
});

test("hidetag replied generic audio is resent as standard audio with hidden mentions", async () => {
  const sentPayloads: any[] = [];
  const downloadCalls: any[] = [];

  const runtime: any = buildBaseRuntime({
    action: {
      kind: "moderation_action",
      action: "hidetag",
      waGroupId: "120363012345678@g.us",
      hidetagContent: { kind: "reply_audio" }
    },
    quotedMessage: {
      audioMessage: {
        mimetype: "audio/mpeg"
      }
    },
    sentPayloads,
    downloadCalls
  });

  await executeOutboundActions(runtime);

  assert.equal(downloadCalls.length, 1);
  assert.equal(sentPayloads.length, 1);
  assert.ok(Buffer.isBuffer(sentPayloads[0]?.audio));
  assert.equal(sentPayloads[0]?.ptt, false);
  assert.equal(sentPayloads[0]?.mimetype, "audio/mpeg");
  assert.deepEqual(sentPayloads[0]?.contextInfo?.mentionedJid, ["111@s.whatsapp.net", "222@s.whatsapp.net"]);
});
