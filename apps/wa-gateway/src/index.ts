import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "baileys";
import { Boom } from "@hapi/boom";
import { Orchestrator, type InboundMessageEvent } from "@zappy/core";
import {
  coreFlagsRepository,
  coreTriggersRepository,
  createCooldownAdapter,
  createQueue,
  createQueueAdapter,
  createRateLimitAdapter,
  createRedisConnection,
  createStatusPort,
  ensureTenantContext,
  identityRepository,
  markGatewayHeartbeat,
  messagesRepository,
  notesRepository,
  persistInboundMessage,
  persistOutboundMessage,
  prisma,
  promptsRepository,
  remindersRepository,
  tasksRepository,
  timersRepository,
  createMuteAdapter,
  createOpenAiAdapter,
  createConversationStateAdapter,
  conversationMemoryRepository
} from "@zappy/adapters";
import { AiService, buildBaseSystemPrompt } from "@zappy/ai";
import { createLogger, loadEnv } from "@zappy/shared";
import qrcodeTerminal from "qrcode-terminal";

const env = loadEnv();
const logger = createLogger("wa-gateway");
const redis = createRedisConnection(env.REDIS_URL);
const queue = createQueue(env.QUEUE_NAME, env.REDIS_URL);
const queueAdapter = createQueueAdapter(queue);
const llmConfigured = Boolean(env.OPENAI_API_KEY);
const llmModel = env.LLM_MODEL ?? env.OPENAI_MODEL;
const baseSystemPrompt = buildBaseSystemPrompt({
  personaId: env.LLM_PERSONA,
  settings: { timezone: env.BOT_TIMEZONE },
  policyNotes: ["Priorize o contexto do chat atual."]
});
const llmAdapter = createOpenAiAdapter(env.OPENAI_API_KEY, llmModel);
const statusPort = createStatusPort({ redis, queue, llmEnabled: env.LLM_ENABLED, llmConfigured });
const muteAdapter = createMuteAdapter(redis);
const aiService = new AiService({
  llm: llmAdapter,
  memory: conversationMemoryRepository as any,
  config: { enabled: env.LLM_ENABLED, personaId: env.LLM_PERSONA, memoryWindow: env.LLM_MEMORY_MESSAGES },
  logger
});

let socket: ReturnType<typeof makeWASocket> | null = null;
const heartbeat = setInterval(() => {
  void markGatewayHeartbeat(redis, Boolean(socket?.user));
}, 10_000);

const orchestrator = new Orchestrator({
  flagsRepository: coreFlagsRepository,
  triggersRepository: coreTriggersRepository,
  tasksRepository,
  remindersRepository,
  notesRepository,
  timersRepository,
  messagesRepository,
  conversationMemory: conversationMemoryRepository,
  aiAssistant: aiService,
  prompt: promptsRepository,
  cooldown: createCooldownAdapter(redis),
  rateLimit: createRateLimitAdapter(redis),
  queue: queueAdapter,
  llm: llmAdapter,
  mute: muteAdapter,
  identity: identityRepository,
  status: statusPort,
  conversationState: createConversationStateAdapter(redis),
  botName: env.DEFAULT_BOT_NAME,
  defaultAssistantMode: env.ASSISTANT_MODE_DEFAULT,
  defaultFunMode: env.FUN_MODE_DEFAULT,
  llmEnabled: env.LLM_ENABLED,
  logger,
  timezone: env.BOT_TIMEZONE,
  baseSystemPrompt,
  llmMemoryMessages: env.LLM_MEMORY_MESSAGES
});

const getText = (message: any): string =>
  message?.conversation ?? message?.extendedTextMessage?.text ?? message?.imageMessage?.caption ?? "";

const hasMedia = (message: any): boolean =>
  Boolean(
    message?.imageMessage ||
      message?.videoMessage ||
      message?.audioMessage ||
      message?.documentMessage ||
      message?.stickerMessage ||
      message?.documentWithCaptionMessage
  );

const connect = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(env.WA_SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  socket = makeWASocket({ auth: state, version, printQRInTerminal: false });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async (update: { connection?: "close" | "open"; lastDisconnect?: { error?: unknown }; qr?: string; isNewLogin?: boolean; pairingCode?: string }) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      logger.info({ qr }, "scan QR to pair");
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (update.isNewLogin === false && update.pairingCode === undefined && process.env.WA_PAIRING_PHONE) {
      const code = await socket?.requestPairingCode(process.env.WA_PAIRING_PHONE);
      logger.info({ code }, "pairing code");
    }
    if (connection === "close") {
      const shouldReconnect = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.warn({ shouldReconnect }, "connection closed");
      if (shouldReconnect) void connect();
    } else if (connection === "open") {
      logger.info({ user: socket?.user?.id }, "connected");
      await markGatewayHeartbeat(redis, true);
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }: { messages: Array<{ key: { fromMe?: boolean; remoteJid?: string; participant?: string; id?: string }; message?: { conversation?: string; extendedTextMessage?: { text?: string }; imageMessage?: { caption?: string } }; messageTimestamp?: number | { toString: () => string } }>; type: string }) => {
    if (type !== "notify" || !socket) return;

    for (const message of messages) {
      if (!message.message || message.key.fromMe) continue;
      const remoteJid = message.key.remoteJid;
      if (!remoteJid) continue;
      const isGroup = remoteJid.endsWith("@g.us");
      if (env.ONLY_GROUP_ID && (!isGroup || remoteJid !== env.ONLY_GROUP_ID)) continue;

      const waUserId = isGroup ? message.key.participant ?? "unknown" : remoteJid;
      const rawText = getText(message.message);
      const text = rawText.trim();
      const mediaPresent = hasMedia(message.message);
      if (!text && !mediaPresent) continue;

      const context = await ensureTenantContext({
        waGroupId: isGroup ? remoteJid : undefined,
        waUserId,
        defaultTenantName: env.DEFAULT_TENANT_NAME,
        onlyGroupId: env.ONLY_GROUP_ID
      });

      const event: InboundMessageEvent = {
        tenantId: context.tenant.id,
        conversationId: undefined,
        waGroupId: isGroup ? remoteJid : undefined,
        waUserId,
        text,
        waMessageId: message.key.id ?? `${Date.now()}`,
        timestamp: new Date((message.messageTimestamp ? Number(message.messageTimestamp) : Date.now() / 1000) * 1000),
        isGroup,
        remoteJid,
        isStatusBroadcast: remoteJid === "status@broadcast",
        isFromBot: Boolean(message.key.fromMe),
        hasMedia: mediaPresent,
        kind: text ? "text" : mediaPresent ? "media" : "unknown",
        rawMessageType: Object.keys(message.message ?? {})[0] ?? "unknown"
      };

      const persisted = await persistInboundMessage({
        ...event,
        userId: context.user.id,
        groupId: context.group?.id,
        rawJson: message
      });
      event.conversationId = persisted.conversationId;
      logger.info({ tenantId: event.tenantId, waUserId, waGroupId: event.waGroupId, messageId: event.waMessageId }, "inbound message");

      const actions = await orchestrator.handleInboundMessage(event);
      for (const action of actions) {
        if (action.kind === "enqueue_job") {
          const runAt = action.payload.runAt ? new Date(action.payload.runAt) : new Date();
          if (action.jobType === "reminder") {
            await queueAdapter.enqueueReminder(String(action.payload.id), runAt);
          } else if (action.jobType === "timer") {
            await queueAdapter.enqueueTimer(String(action.payload.id), runAt);
          } else {
            logger.warn({ jobType: action.jobType, payload: action.payload }, "unknown enqueue_job action");
          }
          continue;
        }
        if (action.kind === "noop") {
          continue;
        }
        if (action.kind === "handoff") {
          const note = action.note ?? "Handoff solicitado.";
          const to = isGroup ? remoteJid : waUserId;
          const sent = await socket.sendMessage(to, { text: note });
          await persistOutboundMessage({
            tenantId: context.tenant.id,
            userId: context.user.id,
            groupId: context.group?.id,
            waUserId,
            waGroupId: event.waGroupId,
            text: note,
            waMessageId: sent.key.id,
            rawJson: sent
          });
          continue;
        }
        if (action.kind === "ai_tool_suggestion") {
          const to = isGroup ? remoteJid : waUserId;
          const textToSend =
            action.text ??
            `Posso executar: ${action.tool.action}. Diga 'ok' para confirmar ou detalhe o que precisa.`;
          const sent = await socket.sendMessage(to, { text: textToSend });
          await persistOutboundMessage({
            tenantId: context.tenant.id,
            userId: context.user.id,
            groupId: context.group?.id,
            waUserId,
            waGroupId: event.waGroupId,
            text: textToSend,
            waMessageId: sent.key.id,
            rawJson: sent
          });
          continue;
        }
        if (action.kind !== "reply_text" && action.kind !== "reply_list") continue;

        const to = isGroup ? remoteJid : waUserId;
        const textToSend =
          action.kind === "reply_text"
            ? action.text
            : [action.header, ...action.items.map((item) => `• ${item.title}${item.description ? ` — ${item.description}` : ""}`), action.footer]
                .filter(Boolean)
                .join("\n");
        const sent = await socket.sendMessage(to, { text: textToSend });
        await persistOutboundMessage({
          tenantId: context.tenant.id,
          userId: context.user.id,
          groupId: context.group?.id,
          waUserId,
          waGroupId: event.waGroupId,
          text: textToSend,
          waMessageId: sent.key.id,
          rawJson: sent
        });
      }
    }
  });
};

const shutdown = async () => {
  clearInterval(heartbeat);
  await markGatewayHeartbeat(redis, false);
  await queue.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled rejection");
});
process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "uncaught exception");
});

void connect();
