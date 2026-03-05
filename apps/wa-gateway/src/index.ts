import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "baileys";
import { Boom } from "@hapi/boom";
import { Orchestrator, type InboundMessageEvent } from "@zappy/core";
import {
  coreFlagsRepository,
  coreTriggersRepository,
  createCooldownAdapter,
  createOpenAiAdapter,
  createQueue,
  createQueueAdapter,
  createRateLimitAdapter,
  createRedisConnection,
  ensureTenantContext,
  messagesRepository,
  persistInboundMessage,
  persistOutboundMessage,
  promptsRepository,
  remindersRepository,
  tasksRepository,
  markGatewayHeartbeat,
  prisma
} from "@zappy/adapters";
import { createLogger, loadEnv } from "@zappy/shared";

const env = loadEnv();
const logger = createLogger("wa-gateway");
const redis = createRedisConnection(env.REDIS_URL);
const queue = createQueue(env.QUEUE_NAME, env.REDIS_URL);

let socket: ReturnType<typeof makeWASocket> | null = null;
const heartbeat = setInterval(() => {
  void markGatewayHeartbeat(redis, Boolean(socket?.user));
}, 10_000);

const orchestrator = new Orchestrator({
  flagsRepository: coreFlagsRepository,
  triggersRepository: coreTriggersRepository,
  tasksRepository,
  remindersRepository,
  messagesRepository,
  prompt: promptsRepository,
  cooldown: createCooldownAdapter(redis),
  rateLimit: createRateLimitAdapter(redis),
  queue: createQueueAdapter(queue),
  llm: createOpenAiAdapter(env.OPENAI_API_KEY, env.OPENAI_MODEL),
  botName: env.DEFAULT_BOT_NAME,
  defaultAssistantMode: env.ASSISTANT_MODE_DEFAULT,
  defaultFunMode: env.FUN_MODE_DEFAULT
});

const getText = (message: any): string =>
  message?.conversation ?? message?.extendedTextMessage?.text ?? message?.imageMessage?.caption ?? "";

const connect = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(env.WA_SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  socket = makeWASocket({ auth: state, version, printQRInTerminal: false });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async (update: { connection?: "close" | "open"; lastDisconnect?: { error?: unknown }; qr?: string; isNewLogin?: boolean; pairingCode?: string }) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) logger.info({ qr }, "scan QR to pair");
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
      const text = getText(message.message).trim();
      if (!text) continue;

      const context = await ensureTenantContext({
        waGroupId: isGroup ? remoteJid : undefined,
        waUserId,
        defaultTenantName: env.DEFAULT_TENANT_NAME,
        onlyGroupId: env.ONLY_GROUP_ID
      });

      const event: InboundMessageEvent = {
        tenantId: context.tenant.id,
        waGroupId: isGroup ? remoteJid : undefined,
        waUserId,
        text,
        waMessageId: message.key.id ?? `${Date.now()}`,
        timestamp: new Date((message.messageTimestamp ? Number(message.messageTimestamp) : Date.now() / 1000) * 1000),
        isGroup
      };

      await persistInboundMessage({ ...event, userId: context.user.id, groupId: context.group?.id, rawJson: message });
      logger.info({ tenantId: event.tenantId, waUserId, waGroupId: event.waGroupId, messageId: event.waMessageId }, "inbound message");

      const actions = await orchestrator.handleInboundMessage(event);
      for (const action of actions) {
        if (action.type === "enqueue_reminder") {
          await createQueueAdapter(queue).enqueueReminder(action.reminderId, action.remindAt);
          continue;
        }
        if (action.type !== "reply") continue;

        const to = isGroup ? remoteJid : waUserId;
        const sent = await socket.sendMessage(to, { text: action.text });
        await persistOutboundMessage({
          tenantId: context.tenant.id,
          userId: context.user.id,
          groupId: context.group?.id,
          waUserId,
          waGroupId: event.waGroupId,
          text: action.text,
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

void connect();
