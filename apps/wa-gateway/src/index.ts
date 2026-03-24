import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, downloadMediaMessage } from "baileys";
import { Boom } from "@hapi/boom";
import { Orchestrator, type InboundMessageEvent } from "@zappy/core";
import { attemptGroupAdminAction } from "./admin-actions.js";
import {
  coreFlagsRepository,
  coreTriggersRepository,
  createCooldownAdapter,
  createQueue,
  createQueueAdapter,
  createRateLimitAdapter,
  createRedisConnection,
  createStatusPort,
  createMetricsRecorder,
  createAuditTrail,
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
import { createLogger, loadEnv, printStartupBanner, withCategory, type InternalGatewaySendTextRequest } from "@zappy/shared";
import qrcodeTerminal from "qrcode-terminal";
import { buildBotAliases, jidMatchesBot, normalizeJid, normalizeLidJid, stripUser } from "./bot-alias.js";
import { startInternalDispatchApi } from "./infrastructure/internal-dispatch-api.js";
import { createCommandGuards } from "./infrastructure/command-guards.js";
import { getInboundContextInfo, getInboundText, hasInboundMedia } from "./infrastructure/inbound-message.js";
import { createBotSelfLidService } from "./infrastructure/bot-self-lid.js";
import { createBotAdminStatusService, GROUP_ADMIN_OPERATION_CACHE_TTL_MS } from "./infrastructure/bot-admin-status.js";
import { executeOutboundActions } from "./infrastructure/outbound-actions.js";

const env = loadEnv();
const logger = createLogger("wa-gateway");
const baileysLogger = logger.child({ name: "baileys", module: "baileys" }, { level: process.env.DEBUG === "trace" ? "debug" : "warn" });
const redis = createRedisConnection(env.REDIS_URL);
const metrics = createMetricsRecorder(redis);
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
const auditTrail = createAuditTrail();
const aiService = new AiService({
  llm: llmAdapter,
  memory: conversationMemoryRepository as any,
  config: {
    enabled: env.LLM_ENABLED,
    personaId: env.LLM_PERSONA,
    memoryWindow: env.LLM_MEMORY_MESSAGES,
    commandPrefix: env.BOT_PREFIX
  },
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
  workerStatus: "PENDING",
  extras: {
    internalDispatchPort: env.WA_GATEWAY_INTERNAL_PORT
  }
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

const botSelfLidService = createBotSelfLidService({
  redis,
  logger,
  defaultBotName: env.DEFAULT_BOT_NAME,
  normalizeLidJid,
  stripUser,
  findOutboundByWaMessageId: async (waMessageId: string) =>
    Boolean(
      await prisma.message.findFirst({
        where: { waMessageId, direction: "OUTBOUND" },
        select: { id: true }
      })
    )
});
let botSelfLid: string | null = null;
const setBotSelfLidKey = (botJid?: string | null) => botSelfLidService.setBotSelfLidKey(botJid);
const loadBotSelfLid = async () => {
  botSelfLid = await botSelfLidService.loadBotSelfLid();
  return botSelfLid;
};
const learnBotSelfLid = async (candidate: string | null | undefined, reason: string) => {
  botSelfLid = await botSelfLidService.learnBotSelfLid(candidate, reason);
  return botSelfLid;
};
const getBotSelfLid = async () => {
  botSelfLid = await botSelfLidService.getBotSelfLid();
  return botSelfLid;
};
const maybeLearnBotLidFromQuote = async (input: {
  quotedWaMessageId?: string;
  quotedParticipantRaw?: string;
  quotedMessage?: any;
}) => {
  botSelfLid = await botSelfLidService.maybeLearnBotLidFromQuote(input);
  return botSelfLid;
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

const dispatchInternalText = async (input: InternalGatewaySendTextRequest): Promise<{ waMessageId: string; raw?: unknown }> => {
  const scope = input.waGroupId || input.to.endsWith("@g.us") ? "group" : "direct";
  const sent = await sendWithReplyFallback({
    to: input.to,
    content: { text: input.text },
    quotedMessage: undefined,
    logContext: {
      tenantId: input.tenantId,
      scope,
      action: input.action,
      referenceId: input.referenceId,
      waUserId: input.waUserId ?? input.to,
      waGroupId: input.waGroupId
    }
  });
  const waMessageId = sent?.key?.id;
  if (!waMessageId) throw new Error("wa_message_id_missing");
  logger.info(
    withCategory("WA-OUT", {
      tenantId: input.tenantId,
      scope,
      action: input.action,
      referenceId: input.referenceId,
      waUserId: input.waUserId ?? input.to,
      waGroupId: input.waGroupId,
      waMessageId,
      textPreview: input.text.slice(0, 80),
      source: "worker_internal"
    }),
    "outbound message"
  );
  return { waMessageId, raw: sent };
};

let socket: ReturnType<typeof makeWASocket> | null = null;
const internalDispatchApi = startInternalDispatchApi({
  port: env.WA_GATEWAY_INTERNAL_PORT,
  token: env.WA_GATEWAY_INTERNAL_TOKEN,
  logger,
  dispatchText: dispatchInternalText
});
const heartbeat = setInterval(() => {
  void markGatewayHeartbeat(redis, Boolean(socket?.user));
}, 10_000);
void markGatewayHeartbeat(redis, false);

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
  commandPrefix: env.BOT_PREFIX,
  baseSystemPrompt,
  llmMemoryMessages: env.LLM_MEMORY_MESSAGES,
  consentTermsVersion: env.CONSENT_TERMS_VERSION,
  consentLink: env.CONSENT_LINK,
  consentSource: env.CONSENT_SOURCE,
  metrics,
  audit: auditTrail
});

const { isBotAdminCommand } = createCommandGuards(env.BOT_PREFIX);

const botAdminStatusService = createBotAdminStatusService({
  getSocket: () => socket,
  normalizeJid,
  withCategory,
  logger,
  attemptGroupAdminAction,
  groupAccessRepository,
  findPersistedGroup: async (waGroupId: string) => prisma.group.findUnique({ where: { waGroupId } })
});
const { resolveSenderGroupAdmin, refreshBotAdminState } = botAdminStatusService;

const connect = async () => {
  logger.info(withCategory("SYSTEM", { status: "WhatsApp CONNECTING" }), "WhatsApp CONNECTING");
  const { state, saveCreds } = await useMultiFileAuthState(env.WA_SESSION_PATH);
  const initialCreds = (state as any)?.creds?.me;
  setBotSelfLidKey(normalizeJid(initialCreds?.id));
  await loadBotSelfLid();
  await learnBotSelfLid(initialCreds?.lid, "creds.me.lid");
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
      const botId = socket?.user?.id ? normalizeJid(socket.user.id) : undefined;
      setBotSelfLidKey(botId);
      await loadBotSelfLid();
      const liveCreds = (socket as any)?.authState?.creds?.me;
      await learnBotSelfLid(liveCreds?.lid, "connection.open.me.lid");
      logger.info(withCategory("SYSTEM", { status: "WhatsApp CONNECTED", user: socket?.user?.id, botLid: botSelfLid }), "WhatsApp CONNECTED");
      await markGatewayHeartbeat(redis, true);
    }
  });

  (socket.ev as any).on("group-participants.update", async (update: { id?: string; participants?: string[]; action?: string }) => {
    try {
      const botId = socket?.user?.id ? normalizeJid(socket.user.id) : undefined;
      if (!update?.id) return;
      const participants = (update.participants ?? []).map((p) => normalizeJid(p));
      const involvesBot = botId ? participants.includes(botId) : false;

      const groupRecord = await prisma.group.findUnique({ where: { waGroupId: update.id } });
      if (involvesBot) {
        const status = await refreshBotAdminState({
          waGroupId: update.id,
          tenantId: groupRecord?.tenantId,
          groupName: groupRecord?.name,
          force: true,
          origin: "participants.update",
          operationFirst: true
        });
        logger.info(
          withCategory("SYSTEM", { waGroupId: update.id, botIsAdmin: status.isAdmin, source: "participants.update" }),
          "refreshed bot admin status"
        );
      }

      if (update.action === "add") {
        const newMembers = participants.filter((p) => p !== botId);
        if (newMembers.length === 0) return;

        let tenantId = groupRecord?.tenantId;
        let groupName = groupRecord?.name ?? update.id;
        if (!tenantId) {
          const context = await ensureTenantContext({
            waGroupId: update.id,
            waUserId: newMembers[0],
            defaultTenantName: env.DEFAULT_TENANT_NAME,
            onlyGroupId: env.ONLY_GROUP_ID,
            remoteJid: update.id,
            userName: null
          });
          tenantId = context.tenant.id;
          groupName = context.group?.name ?? update.id;
        }

        const access = tenantId
          ? await groupAccessRepository.getGroupAccess({
              tenantId,
              waGroupId: update.id,
              groupName,
              botIsAdmin: groupRecord?.botIsAdmin ?? undefined
            })
          : null;

        if (access?.welcomeEnabled) {
          const names = newMembers.map((p) => stripUser(p) ?? p).join(", ");
          const base = access.welcomeText ?? "Bem-vindo(a), {{user}}!";
          let text = base.replace(/{{user}}/g, names).replace(/{{group}}/g, access.groupName ?? update.id);
          if (access.rulesText) text += `\n\nRegras:\n${access.rulesText}`;
          if (access.fixedMessageText) text += `\n\n${access.fixedMessageText}`;

          const sent = await sendWithReplyFallback({
            to: update.id,
            content: { text },
            quotedMessage: undefined,
            logContext: { tenantId: tenantId ?? "unknown", scope: "group", action: "welcome", waUserId: newMembers[0], waGroupId: update.id }
          });

          if (tenantId) {
            await persistOutboundMessage({
              tenantId,
              userId: undefined,
              groupId: groupRecord?.id,
              waUserId: newMembers[0],
              waGroupId: update.id,
              text,
              waMessageId: sent?.key?.id,
              rawJson: sent
            });
          }
        }
      }
    } catch (error) {
      logger.warn(withCategory("WARN", { waGroupId: update?.id, error }), "failed to handle participant update");
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
      const rawText = getInboundText(message.message);
      const text = rawText.trim();
      const mediaPresent = hasInboundMedia(message.message);
      if (!text && !mediaPresent) continue;
      const botJid = socket.user?.id ? normalizeJid(socket.user.id) : undefined;
      setBotSelfLidKey(botJid);
      const storedBotLid = await getBotSelfLid();
      const contextInfo = getInboundContextInfo(message.message);
      const mentionedRaw = (contextInfo?.mentionedJid as string[] | undefined) ?? [];
      const mentionedWaUserIds = mentionedRaw.map((jid) => normalizeJid(jid));
      const quotedWaMessageId = (contextInfo as any)?.stanzaId as string | undefined;
      const quotedWaUserIdRaw = (contextInfo as any)?.participant as string | undefined;
      const quotedWaUserId = quotedWaUserIdRaw ? normalizeJid(quotedWaUserIdRaw) : undefined;
      const quotedRemoteJid = (contextInfo as any)?.remoteJid as string | undefined;
      const quotedMessageExists = Boolean((contextInfo as any)?.quotedMessage);
      await maybeLearnBotLidFromQuote({
        quotedWaMessageId,
        quotedParticipantRaw: quotedWaUserIdRaw,
        quotedMessage: (contextInfo as any)?.quotedMessage
      });
      const botLid = botSelfLid ?? storedBotLid;
      const botAliases = buildBotAliases({ pnJid: socket.user?.id, lidJid: botLid });
      const isReplyToBot = botAliases.some((alias) => jidMatchesBot(quotedWaUserIdRaw, alias));
      const isBotMentioned = botAliases.length > 0 ? mentionedWaUserIds.some((jid) => botAliases.some((alias) => jidMatchesBot(jid, alias))) : false;

      if (isGroup && process.env.NODE_ENV !== "production") {
        const textPreview = text.slice(0, 120);
        const line = [
          "[GROUP_DEBUG]",
          `text="${textPreview.replace(/"/g, '\\"')}"`,
          `remoteJid="${remoteJid}"`,
          `participant="${message.key.participant ?? ""}"`,
          `mentionedRaw=[${mentionedRaw.join(",")}]`,
          `mentionedNorm=[${mentionedWaUserIds.join(",")}]`,
          `botAliases=[${botAliases.join(",")}]`,
          `mentionMatched=${isBotMentioned}`,
          `quotedExists=${quotedMessageExists}`,
          `quotedParticipantRaw="${quotedWaUserIdRaw ?? ""}"`,
          `quotedParticipantNorm="${quotedWaUserId ?? ""}"`,
          `quotedRemoteJid="${quotedRemoteJid ?? ""}"`,
          `replyMatched=${isReplyToBot}`,
          `isBotMentioned=${isBotMentioned}`,
          `isReplyToBot=${isReplyToBot}`
        ].join(" ");
        logger.debug(line);
      }

      const context = await ensureTenantContext({
        waGroupId: isGroup ? remoteJid : undefined,
        waUserId,
        defaultTenantName: env.DEFAULT_TENANT_NAME,
        onlyGroupId: env.ONLY_GROUP_ID,
        remoteJid,
        userName: message.pushName ?? null
      });

      const lastAdminCheck = context.group?.botAdminCheckedAt?.getTime?.() ?? 0;
      const adminCommand = isGroup && isBotAdminCommand(text);
      const senderIsGroupAdmin = isGroup ? await resolveSenderGroupAdmin(remoteJid, waUserId) : undefined;
      const adminStatusStaleMs = GROUP_ADMIN_OPERATION_CACHE_TTL_MS;
      const shouldForceAdminRefresh =
        isGroup &&
        (adminCommand ||
          !context.group?.botAdminCheckedAt ||
          Date.now() - lastAdminCheck > adminStatusStaleMs ||
          context.group?.botIsAdmin === false);
      const botAdminStatus = isGroup
        ? await refreshBotAdminState({
            waGroupId: remoteJid,
            tenantId: context.tenant.id,
            groupName: context.group?.name ?? message.pushName ?? remoteJid,
            force: shouldForceAdminRefresh,
            origin: "messages.upsert",
            operationFirst: shouldForceAdminRefresh
          })
        : undefined;
      const botAdminCheckedAt = botAdminStatus?.checkedAt ? new Date(botAdminStatus.checkedAt) : context.group?.botAdminCheckedAt ?? undefined;
      const botIsGroupAdmin = isGroup ? botAdminStatus?.isAdmin ?? context.group?.botIsAdmin ?? undefined : undefined;
      const botAdminError = botAdminStatus?.error ?? botAdminStatus?.metadataError ?? botAdminStatus?.actionErrorMessage;
      const botAdminCheckFailed =
        botAdminStatus?.source === "fallback" || botAdminStatus?.actionResultKind === "failed_metadata_unavailable";
      const messageKey = {
        id: message.key.id ?? `${Date.now()}`,
        remoteJid: message.key.remoteJid,
        fromMe: message.key.fromMe,
        participant: message.key.participant
      };

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
        senderIsGroupAdmin,
        botIsGroupAdmin,
        botAdminStatusSource: botAdminStatus?.source,
        botAdminCheckFailed,
        botAdminCheckError: botAdminError,
        botAdminCheckedAt,
        groupName: context.group?.name ?? message.pushName ?? remoteJid ?? undefined,
        messageKey
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
      await executeOutboundActions({
        actions,
        isGroup,
        remoteJid,
        waUserId,
        event,
        message,
        context,
        contextInfo,
        quotedWaMessageId,
        quotedWaUserId,
        canonical,
        normalizedPhone,
        relationshipProfile,
        permissionRole,
        timezone: env.BOT_TIMEZONE,
        sendWithReplyFallback,
        persistOutboundMessage,
        queueAdapter,
        groupAccessRepository,
        muteAdapter,
        attemptGroupAdminAction,
        getSocket: () => socket,
        downloadMediaMessage,
        baileysLogger,
        normalizeJid,
        logger,
        withCategory,
        metrics,
        auditTrail
      });
    }
  });
};

const shutdown = async () => {
  clearInterval(heartbeat);
  await markGatewayHeartbeat(redis, false);
  await internalDispatchApi.close();
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
