import { strict as assert } from "node:assert";
import test from "node:test";
import { executeOutboundActions } from "../src/infrastructure/outbound-actions.js";

test("smoke: reply_video sends outbound video payload without throwing", async () => {
  const sentPayloads: any[] = [];

  const runtime: any = {
    actions: [
      {
        kind: "reply_video",
        videoUrl: "https://cdn.example.com/media/reel.mp4",
        mimeType: "video/mp4",
        caption: "reel test"
      }
    ],
    isGroup: false,
    remoteJid: "556699999999@s.whatsapp.net",
    waUserId: "556699999999@s.whatsapp.net",
    event: {
      tenantId: "tenant_test",
      waGroupId: undefined,
      waUserId: "556699999999@s.whatsapp.net",
      waMessageId: "wamid.video.test",
      executionId: "exec.video.test"
    },
    message: {
      key: {
        id: "wamid.video.test",
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
      sentPayloads.push(content);
      return { key: { id: `out_${sentPayloads.length}` } };
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
      debug: () => {},
      info: () => {},
      warn: () => {}
    },
    withCategory: (_category: unknown, payload?: Record<string, unknown>) => payload ?? {},
    metrics: { increment: async () => {} },
    auditTrail: { record: async () => {} },
    stickerMaxVideoSeconds: 10
  };

  await assert.doesNotReject(async () => {
    await executeOutboundActions(runtime);
  });

  assert.equal(sentPayloads.length, 1);
  assert.deepEqual(sentPayloads[0]?.video, { url: "https://cdn.example.com/media/reel.mp4" });
  assert.equal(sentPayloads[0]?.caption, "reel test");
});
