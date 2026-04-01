import { strict as assert } from "node:assert";
import test from "node:test";
import { executeOutboundActions } from "../src/infrastructure/outbound-actions.js";

test("spoken reminder intent dispatches real reminder command instead of generic respond flow", async () => {
  const dispatched: Array<{ text: string; transcript: string; commandText?: string; action: string }> = [];

  const runtime: any = {
    actions: [
      {
        kind: "audio_transcription",
        source: "quoted",
        mode: "transcribe_and_route",
        allowCommandDispatch: true,
        origin: "auto"
      }
    ],
    isGroup: false,
    remoteJid: "556699999999@s.whatsapp.net",
    waUserId: "556699999999@s.whatsapp.net",
    event: {
      tenantId: "tenant_test",
      waUserId: "556699999999@s.whatsapp.net",
      waMessageId: "wamid.audio.reminder",
      executionId: "exec.audio.reminder",
      quotedWaMessageId: "quoted-audio-1",
      quotedWaUserId: "556688888888@s.whatsapp.net"
    },
    message: {
      key: {
        id: "wamid.audio.reminder",
        remoteJid: "556699999999@s.whatsapp.net",
        fromMe: false
      }
    },
    context: {
      tenant: { id: "tenant_test" },
      user: { id: "user_test" },
      group: undefined
    },
    contextInfo: {
      quotedMessage: {
        audioMessage: {
          mimetype: "audio/ogg; codecs=opus",
          ptt: true,
          seconds: 8,
          fileLength: 18000
        }
      }
    },
    commandPrefix: "/",
    progressReactions: { enabled: true, processingEmoji: "⏳", successEmoji: "✅", failureEmoji: "❌" },
    audioConfig: {
      enabled: true,
      sttModel: "gpt-4o-mini-transcribe",
      sttTimeoutMs: 10_000,
      maxDurationSeconds: 120,
      maxBytes: 2 * 1024 * 1024,
      language: "pt",
      commandDispatchEnabled: true,
      commandPrefix: "/",
      commandAllowlist: ["help", "reminder", "task", "note", "timer"],
      commandMinConfidence: 0.8,
      transcriptPreviewChars: 120
    },
    speechToText: {
      transcribe: async () => ({
        text: "cria um lembrete para mim em 5 minutos para tomar meu remédio",
        elapsedMs: 110
      })
    },
    dispatchTranscribedText: async (input: { text: string; transcript: string; commandText?: string; action: string }) => {
      dispatched.push(input);
      return { hadResponses: true, dispatchExecutionId: "exec-dispatch-reminder-1" };
    },
    sendWithReplyFallback: async () => ({ key: { id: "out-1" } }),
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
      sendMessage: async () => ({ ok: true }),
      updateMediaMessage: async () => ({ ok: true })
    }),
    downloadMediaMessage: async () => Buffer.from([1, 2, 3, 4]),
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

  await executeOutboundActions(runtime);

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.action, "dispatch_command");
  assert.match(dispatched[0]?.text ?? "", /^\/reminder\b/i);
  assert.equal(dispatched[0]?.commandText, dispatched[0]?.text);
});

