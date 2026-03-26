import { strict as assert } from "node:assert";
import test from "node:test";
import { executeOutboundActions } from "../src/infrastructure/outbound-actions.js";

test("smoke: reply_image media failure degrades to text fallback without throwing", async () => {
  const attempts: Array<{ type: "image" | "text"; payload: any }> = [];

  const runtime: any = {
    actions: [
      {
        kind: "reply_image",
        imageUrl: "https://cdn.example.com/blocked.jpg",
        imageBase64: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(700, 3)]).toString("base64"),
        mimeType: "image/jpeg",
        caption: "Teste",
        fallbackText: "Nao consegui enviar a imagem agora."
      }
    ],
    isGroup: false,
    remoteJid: "556699999999@s.whatsapp.net",
    waUserId: "556699999999@s.whatsapp.net",
    event: {
      tenantId: "tenant_test",
      waGroupId: undefined,
      waUserId: "556699999999@s.whatsapp.net",
      waMessageId: "wamid.test",
      executionId: "exec.test"
    },
    message: {
      key: {
        id: "wamid.test",
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
      if (content?.image) {
        attempts.push({ type: "image", payload: content });
        throw new Error("media_send_failed_403");
      }
      attempts.push({ type: "text", payload: content });
      return { key: { id: `msg_${attempts.length}` } };
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

  assert.equal(attempts.filter((entry) => entry.type === "image").length, 1);
  assert.equal(attempts.filter((entry) => entry.type === "text").length, 1);
  assert.equal(attempts.find((entry) => entry.type === "text")?.payload?.text, "Nao consegui enviar a imagem agora.");
});
