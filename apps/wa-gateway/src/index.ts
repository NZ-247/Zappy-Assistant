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
  conversationMemoryRepository,
  consentRepository,
  groupAccessRepository,
  botAdminRepository
} from "@zappy/adapters";
import { AiService, buildBaseSystemPrompt } from "@zappy/ai";
import { createLogger, loadEnv, printStartupBanner, withCategory } from "@zappy/shared";
import qrcodeTerminal from "qrcode-terminal";

const env = loadEnv();
const logger = createLogger("wa-gateway");
const baileysLogger = logger.child({ name: "baileys", module: "baileys" }, { level: process.env.DEBUG === "trace" ? "debug" : "warn" });
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

const adminApiUrl = `http://localhost:${env.ADMIN_API_PORT}`;
const adminUiUrl = `http://localhost:${env.ADMIN_UI_PORT}`;
printStartupBanner(logger, {
  app: "WA Gateway",
  environment: env.NODE_ENV,
  timezone: env.BOT_TIMEZONE,
  llmEnabled: env.LLM_ENABLED && llmConfigured,
  model: llmModel,
  adminApiUrl,
  adminUiUrl,
  queueName: env.QUEUE_NAME,
  waSessionPath: env.WA_SESSION_PATH,
  redisStatus: "PENDING",
  dbStatus: "PENDING",
  llmStatus: env.LLM_ENABLED ? (llmConfigured ? "PENDING" : "FAIL") : undefined,
  workerStatus: "PENDING"
});

const reportStartupStatus = async () => {
  const dbOk = await prisma
    .$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false);
  const redisOk = await redis
    .ping()
    .then(() => true)
    .catch(() => false);
  logger.info(
    withCategory("DB", { status: dbOk ? "OK" : "FAIL" }),
    dbOk ? "DB OK" : "DB FAIL"
  );
  logger.info(
    withCategory("SYSTEM", { target: "Redis", status: redisOk ? "OK" : "FAIL" }),
    redisOk ? "Redis OK" : "Redis FAIL"
  );
};

type OutboundSendInput = {
  to: string;
  content: any;
  quotedMessage?: any;
  logContext: Record<string, unknown>;
};

const sendWithReplyFallback = async ({ to, content, quotedMessage, logContext }: OutboundSendInput) => {
  if (!socket) throw new Error("Socket not ready");
  if (quotedMessage) {
    try {
      return await socket.sendMessage(to, content, { quoted: quotedMessage });
    } catch (error) {
      logger.debug(
        withCategory("WA-OUT", { ...logContext, error, replyTo: quotedMessage?.key?.id, note: "quoted_send_failed" }),
        "quoted send failed; falling back without reply context"
      );
    }
  } else {
    logger.debug(withCategory("WA-OUT", { ...logContext, note: "quoted_message_missing" }), "no quoted message available; sending without reply context");
  }
  return socket.sendMessage(to, content);
};

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
  llmModel,
  mute: muteAdapter,
  identity: identityRepository,
  groupAccess: groupAccessRepository,
  adminAccess: botAdminRepository,
  status: statusPort,
  conversationState: createConversationStateAdapter(redis),
  consent: consentRepository,
  botName: env.DEFAULT_BOT_NAME,
  defaultAssistantMode: env.ASSISTANT_MODE_DEFAULT,
  defaultFunMode: env.FUN_MODE_DEFAULT,
  llmEnabled: env.LLM_ENABLED,
  logger,
  timezone: env.BOT_TIMEZONE,
  baseSystemPrompt,
  llmMemoryMessages: env.LLM_MEMORY_MESSAGES,
  consentTermsVersion: env.CONSENT_TERMS_VERSION,
  consentLink: env.CONSENT_LINK,
  consentSource: env.CONSENT_SOURCE
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

const normalizeJid = (jid?: string | null): string => (jid ? jid.split(":")[0] : "");
const groupAdminCache = new Map<string, { isAdmin: boolean; checkedAt: number }>();
const GROUP_ADMIN_CACHE_TTL_MS = 3 * 60 * 1000;

const getContextInfo = (message: any) =>
  message?.extendedTextMessage?.contextInfo ??
  message?.imageMessage?.contextInfo ??
  message?.videoMessage?.contextInfo ??
  message?.documentMessage?.contextInfo ??
  message?.stickerMessage?.contextInfo ??
  message?.audioMessage?.contextInfo ??
  message?.buttonsResponseMessage?.contextInfo ??
  message?.templateButtonReplyMessage?.contextInfo ??
  undefined;

const ensureBotAdminStatus = async (groupJid: string): Promise<boolean> => {
  const cached = groupAdminCache.get(groupJid);
  if (cached && Date.now() - cached.checkedAt < GROUP_ADMIN_CACHE_TTL_MS) return cached.isAdmin;
  if (!socket?.user?.id) return false;
  try {
    const metadata = await socket.groupMetadata(groupJid);
    const botId = normalizeJid(socket.user.id);
    const isAdmin = Boolean(
      metadata?.participants?.some((p: any) => normalizeJid(p.id) === botId && Boolean(p.admin || p.isAdmin || p.admin === "admin"))
    );
    groupAdminCache.set(groupJid, { isAdmin, checkedAt: Date.now() });
    return isAdmin;
  } catch (error) {
    logger.warn(withCategory("WARN", { waGroupId: groupJid, error }), "failed to resolve group admin status");
    groupAdminCache.set(groupJid, { isAdmin: false, checkedAt: Date.now() });
    return false;
  }
};

const connect = async () => {
  logger.info(withCategory("SYSTEM", { status: "WhatsApp CONNECTING" }), "WhatsApp CONNECTING");
  const { state, saveCreds } = await useMultiFileAuthState(env.WA_SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  socket = makeWASocket({ auth: state, version, printQRInTerminal: false, logger: baileysLogger });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async (update: { connection?: "close" | "open"; lastDisconnect?: { error?: unknown }; qr?: string; isNewLogin?: boolean; pairingCode?: string }) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      logger.info(withCategory("SYSTEM", { status: "WhatsApp QR READY", qr }), "WhatsApp QR READY");
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (update.isNewLogin === false && update.pairingCode === undefined && process.env.WA_PAIRING_PHONE) {
      const code = await socket?.requestPairingCode(process.env.WA_PAIRING_PHONE);
      logger.info(withCategory("SYSTEM", { status: "WhatsApp PAIRING", code }), "pairing code");
    }
    if (connection === "close") {
      const shouldReconnect = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.warn(withCategory("WARN", { status: "WhatsApp DISCONNECTED", shouldReconnect }), "WhatsApp DISCONNECTED");
      if (shouldReconnect) void connect();
    } else if (connection === "open") {
      logger.info(withCategory("SYSTEM", { status: "WhatsApp CONNECTED", user: socket?.user?.id }), "WhatsApp CONNECTED");
      await markGatewayHeartbeat(redis, true);
    }
  });

  socket.ev.on(
    "messages.upsert",
    async ({
      messages,
      type
    }: {
      messages: Array<{
        key: { fromMe?: boolean; remoteJid?: string; participant?: string; id?: string };
        message?: { conversation?: string; extendedTextMessage?: { text?: string }; imageMessage?: { caption?: string } };
        messageTimestamp?: number | { toString: () => string };
        pushName?: string;
      }>;
      type: string;
    }) => {
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
      const botJid = socket.user?.id ? normalizeJid(socket.user.id) : undefined;
      const contextInfo = getContextInfo(message.message);
      const mentionedWaUserIds = (contextInfo?.mentionedJid as string[] | undefined) ?? [];
      const quotedWaMessageId = (contextInfo as any)?.stanzaId as string | undefined;
      const quotedWaUserId = (contextInfo as any)?.participant as string | undefined;
      const isReplyToBot = botJid ? normalizeJid(quotedWaUserId) === botJid : false;
      const isBotMentioned = botJid ? mentionedWaUserIds.some((jid) => normalizeJid(jid) === botJid) : false;
      const botIsGroupAdmin = isGroup ? await ensureBotAdminStatus(remoteJid) : false;

      const context = await ensureTenantContext({
        waGroupId: isGroup ? remoteJid : undefined,
        waUserId,
        defaultTenantName: env.DEFAULT_TENANT_NAME,
        onlyGroupId: env.ONLY_GROUP_ID,
        remoteJid,
        userName: message.pushName ?? null
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
        rawMessageType: Object.keys(message.message ?? {})[0] ?? "unknown",
        mentionedWaUserIds,
        isBotMentioned,
        quotedWaMessageId,
        quotedWaUserId,
        isReplyToBot,
        botIsGroupAdmin,
        groupName: context.group?.name ?? undefined
      };

      const persisted = await persistInboundMessage({
        ...event,
        userId: context.user.id,
        groupId: context.group?.id,
        rawJson: message
      });
      event.conversationId = persisted.conversationId;
      const canonical = context.canonicalIdentity;
      const relationshipProfile = context.relationshipProfile ?? canonical?.relationshipProfile;
      const permissionRole = context.user.permissionRole ?? canonical?.permissionRole ?? context.user.role;
      const normalizedPhone = canonical?.phoneNumber ? canonical.phoneNumber.replace(/\D/g, "") : undefined;
      logger.info(
        withCategory("WA-IN", {
          tenantId: event.tenantId,
          scope: isGroup ? "group" : "direct",
          waUserId,
          phoneNumber: canonical?.phoneNumber,
          normalizedPhone,
          lidJid: canonical?.lidJid,
          pnJid: canonical?.pnJid,
          relationshipProfile,
          permissionRole,
          waMessageId: event.waMessageId,
          waGroupId: event.waGroupId,
          textPreview: text.slice(0, 80),
          hasMedia: event.hasMedia,
          messageType: event.rawMessageType
        }),
        "inbound message"
      );

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
          const sent = await sendWithReplyFallback({
            to,
            content: { text: note },
            quotedMessage: message,
            logContext: {
              tenantId: event.tenantId,
              scope: isGroup ? "group" : "direct",
              action: "handoff",
              waUserId,
              waGroupId: event.waGroupId
            }
          });
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
          logger.info(
            withCategory("WA-OUT", {
              tenantId: event.tenantId,
              scope: isGroup ? "group" : "direct",
              waUserId,
              phoneNumber: canonical?.phoneNumber,
              normalizedPhone,
              permissionRole,
              relationshipProfile,
              waGroupId: event.waGroupId,
              waMessageId: sent.key.id,
              action: "handoff",
              textPreview: note.slice(0, 80)
            }),
            "outbound message"
          );
          continue;
        }
        if (action.kind === "ai_tool_suggestion") {
          const to = isGroup ? remoteJid : waUserId;
          const textToSend =
            action.text ??
            `Posso executar: ${action.tool.action}. Diga 'ok' para confirmar ou detalhe o que precisa.`;
          const sent = await sendWithReplyFallback({
            to,
            content: { text: textToSend },
            quotedMessage: message,
            logContext: {
              tenantId: event.tenantId,
              scope: isGroup ? "group" : "direct",
              action: "ai_tool_suggestion",
              waUserId,
              waGroupId: event.waGroupId
            }
          });
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
          logger.info(
            withCategory("WA-OUT", {
              tenantId: event.tenantId,
              scope: isGroup ? "group" : "direct",
              waUserId,
              phoneNumber: canonical?.phoneNumber,
              normalizedPhone,
              permissionRole,
              relationshipProfile,
              waGroupId: event.waGroupId,
              waMessageId: sent.key.id,
              action: "ai_tool_suggestion",
              textPreview: textToSend.slice(0, 80)
            }),
            "outbound message"
          );
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
        const sent = await sendWithReplyFallback({
          to,
          content: { text: textToSend },
          quotedMessage: message,
          logContext: {
            tenantId: event.tenantId,
            scope: isGroup ? "group" : "direct",
            action: action.kind,
            waUserId,
            waGroupId: event.waGroupId
          }
        });
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
        logger.info(
            withCategory("WA-OUT", {
              tenantId: event.tenantId,
              scope: isGroup ? "group" : "direct",
              waUserId,
              phoneNumber: canonical?.phoneNumber,
              normalizedPhone,
              permissionRole,
              relationshipProfile,
              waGroupId: event.waGroupId,
              waMessageId: sent.key.id,
              action: action.kind,
              textPreview: textToSend.slice(0, 80)
          }),
          "outbound message"
        );
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
  logger.error(withCategory("ERROR", { err: reason }), "unhandled rejection");
});
process.on("uncaughtException", (error) => {
  logger.error(withCategory("ERROR", { err: error }), "uncaught exception");
});

void reportStartupStatus();
void connect();
