import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, downloadMediaMessage } from "baileys";
import { Boom } from "@hapi/boom";
import { Orchestrator, type InboundMessageEvent } from "@zappy/core";
import { attemptGroupAdminAction, type AdminActionResultKind } from "./admin-actions.js";
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
import { createLogger, loadEnv, printStartupBanner, withCategory } from "@zappy/shared";
import qrcodeTerminal from "qrcode-terminal";
import { buildBotAliases, jidMatchesBot, normalizeJid, normalizeLidJid, stripUser } from "./bot-alias.js";

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

const BOT_SELF_LID_KEY_BASE = "bot:self:lid";
let botSelfLid: string | null = null;
let botSelfLidLoaded = false;
let botSelfLidKey = `${BOT_SELF_LID_KEY_BASE}:${env.DEFAULT_BOT_NAME ?? "default"}`;

const setBotSelfLidKey = (botJid?: string | null) => {
  const suffix = stripUser(botJid ?? "") || env.DEFAULT_BOT_NAME || "default";
  const nextKey = `${BOT_SELF_LID_KEY_BASE}:${suffix}`;
  if (nextKey !== botSelfLidKey) {
    botSelfLidKey = nextKey;
    botSelfLidLoaded = false;
  }
};

const loadBotSelfLid = async (): Promise<string | null> => {
  if (botSelfLidLoaded) return botSelfLid;
  const stored = await redis.get(botSelfLidKey);
  botSelfLid = normalizeLidJid(stored);
  botSelfLidLoaded = true;
  return botSelfLid;
};

const learnBotSelfLid = async (candidate: string | null | undefined, reason: string): Promise<string | null> => {
  const lid = normalizeLidJid(candidate);
  if (!lid) return null;
  await loadBotSelfLid();
  if (botSelfLid === lid) return botSelfLid;
  botSelfLid = lid;
  botSelfLidLoaded = true;
  await redis.set(botSelfLidKey, lid);
  if (process.env.NODE_ENV !== "production") {
    logger.debug(
      withCategory("SYSTEM", { action: "learn_bot_lid", lid, reason, key: botSelfLidKey }),
      "learned bot self LID alias"
    );
  }
  return botSelfLid;
};

const getBotSelfLid = async (): Promise<string | null> => {
  await loadBotSelfLid();
  return botSelfLid;
};

const maybeLearnBotLidFromQuote = async (input: {
  quotedWaMessageId?: string;
  quotedParticipantRaw?: string;
  quotedMessage?: any;
}) => {
  const candidate = normalizeLidJid(input.quotedParticipantRaw);
  if (!candidate) return null;

  const quotedFromMe = Boolean(input.quotedMessage?.key?.fromMe);
  let outboundMatch = false;
  if (input.quotedWaMessageId) {
    try {
      outboundMatch = Boolean(
        await prisma.message.findFirst({
          where: { waMessageId: input.quotedWaMessageId, direction: "OUTBOUND" },
          select: { id: true }
        })
      );
    } catch (error) {
      logger.warn(withCategory("WARN", { action: "lookup_quoted_outbound", error }), "failed to verify quoted outbound message");
    }
  }

  if (!quotedFromMe && !outboundMatch) return null;
  return learnBotSelfLid(candidate, quotedFromMe ? "quote_from_me" : "quote_outbound_lookup");
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
  baseSystemPrompt,
  llmMemoryMessages: env.LLM_MEMORY_MESSAGES,
  consentTermsVersion: env.CONSENT_TERMS_VERSION,
  consentLink: env.CONSENT_LINK,
  consentSource: env.CONSENT_SOURCE,
  metrics,
  audit: auditTrail
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

const isBotAdminCommand = (text: string): boolean => {
  const lower = text.trim().toLowerCase();
  if (lower.startsWith("/chat ")) return true;
  if (lower.startsWith("/set gp ")) return true;
  if (lower === "/add gp allowed_groups") return true;
  if (lower === "/rm gp allowed_groups") return true;
  if (lower.startsWith("/ban") || lower.startsWith("/kick") || lower.startsWith("/hidetag") || lower.startsWith("/unmute")) return true;
  if (lower.startsWith("/mute ")) return true;
  return false;
};

const isGroupAdminCommand = (text: string): boolean => {
  const lower = text.trim().toLowerCase();
  return (
    lower.startsWith("/set gp ") ||
    lower.startsWith("/add gp allowed_groups") ||
    lower.startsWith("/rm gp allowed_groups") ||
    lower.startsWith("/add user admins") ||
    lower.startsWith("/rm user admins") ||
    lower.startsWith("/list user admins") ||
    lower.startsWith("/chat ") ||
    lower.startsWith("/ban") ||
    lower.startsWith("/kick") ||
    lower.startsWith("/mute ") ||
    lower.startsWith("/unmute") ||
    lower.startsWith("/hidetag")
  );
};

type BotAdminStatus = {
  isAdmin?: boolean;
  checkedAt: number;
  source: "cache" | "live" | "fallback" | "operation";
  error?: string;
  cached?: boolean;
  metadataFetched?: boolean;
  metadataError?: string;
  participantFound?: boolean;
  participantAdmin?: boolean;
  participantAdminLabel?: string | boolean | null;
  botJidRaw?: string;
  botJidNormalized?: string;
  actionResultKind?: AdminActionResultKind;
  actionErrorMessage?: string;
};

const groupAdminCache = new Map<string, BotAdminStatus>();
const GROUP_ADMIN_CACHE_TTL_MS = 3 * 60 * 1000;
const GROUP_ADMIN_OPERATION_CACHE_TTL_MS = 10 * 60 * 1000;

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

const ensureBotAdminStatus = async (
  groupJid: string,
  options?: { forceRefresh?: boolean; operationFirst?: boolean; reason?: string }
): Promise<BotAdminStatus> => {
  const now = Date.now();
  const cached = groupAdminCache.get(groupJid);
  const cacheTtl =
    cached?.source === "operation" ? GROUP_ADMIN_OPERATION_CACHE_TTL_MS : GROUP_ADMIN_CACHE_TTL_MS;
  if (!options?.forceRefresh && cached && now - cached.checkedAt < cacheTtl) {
    return { ...cached, cached: true };
  }

  const botJidRaw = socket?.user?.id;
  const botJidNormalized = botJidRaw ? normalizeJid(botJidRaw) : undefined;

  if (!botJidRaw) {
    const fallback: BotAdminStatus = {
      isAdmin: cached?.isAdmin,
      checkedAt: now,
      source: "fallback",
      error: "socket_not_ready",
      metadataFetched: false,
      botJidRaw,
      botJidNormalized
    };
    groupAdminCache.set(groupJid, fallback);
    return fallback;
  }

  const activeSocket = socket as NonNullable<typeof socket>;

  const shouldProbeOperation =
    options?.operationFirst || !cached || cached.source === "fallback" || cached.isAdmin === false || options?.forceRefresh;

  const operationResult = shouldProbeOperation
    ? await attemptGroupAdminAction({
        actionName: "probe_group_admin",
        groupJid,
        run: async () => activeSocket.groupInviteCode(groupJid)
      })
    : null;

  let metadataFetched = false;
  let participantFound = false;
  let participantAdmin: boolean | undefined;
  let participantAdminLabel: string | boolean | null = null;
  let metadataError: string | undefined;

  try {
    const metadata = await activeSocket.groupMetadata(groupJid);
    metadataFetched = true;
    const participant = metadata?.participants?.find((p: any) => normalizeJid(p.id) === botJidNormalized);
    participantFound = Boolean(participant);
    participantAdminLabel = participant?.admin ?? participant?.isAdmin ?? null;
    participantAdmin =
      participant &&
      (participant.admin === "admin" ||
        participant.admin === "superadmin" ||
        participant.isAdmin === true ||
        participant.admin === true);
  } catch (error) {
    metadataError = (error as Error)?.message ?? "metadata_fetch_failed";
  }

  const buildStatus = (): BotAdminStatus => {
    const base: BotAdminStatus = {
      isAdmin: undefined,
      checkedAt: now,
      source: "fallback",
      botJidRaw,
      botJidNormalized,
      metadataFetched,
      metadataError,
      participantFound,
      participantAdmin,
      participantAdminLabel
    };

    if (operationResult) {
      const { kind, attemptedAt, errorMessage } = operationResult;
      if (kind === "success") {
        return {
          ...base,
          isAdmin: true,
          checkedAt: attemptedAt,
          source: "operation",
          actionResultKind: kind,
          actionErrorMessage: errorMessage
        };
      }
      if (kind === "failed_not_admin" || kind === "failed_not_authorized") {
        return {
          ...base,
          isAdmin: false,
          checkedAt: attemptedAt,
          source: "operation",
          actionResultKind: kind,
          actionErrorMessage: errorMessage
        };
      }
      return {
        ...base,
        checkedAt: attemptedAt,
        source: "operation",
        actionResultKind: kind,
        actionErrorMessage: errorMessage,
        isAdmin: cached?.isAdmin ?? undefined
      };
    }

    if (metadataFetched && typeof participantAdmin === "boolean") {
      return { ...base, isAdmin: participantAdmin, source: "live" };
    }

    if (cached) {
      const derivedSource = cached.source === "operation" ? "operation" : cached.source ?? "cache";
      return { ...base, isAdmin: cached.isAdmin, source: derivedSource };
    }

    return base;
  };

  const status = buildStatus();
  groupAdminCache.set(groupJid, status);
  return status;
};

const resolveSenderGroupAdmin = async (groupJid: string, waUserId: string): Promise<boolean | undefined> => {
  if (!socket) return undefined;
  try {
    const meta = await socket.groupMetadata(groupJid);
    const target = normalizeJid(waUserId);
    const participant = meta?.participants?.find((p: any) => normalizeJid(p.id) === target);
    if (!participant) return undefined;
    const adminFlag = (participant.admin ?? "").toString().toLowerCase();
    return adminFlag === "admin" || adminFlag === "superadmin";
  } catch (error) {
    logger.debug(withCategory("WARN", { action: "resolve_sender_admin", waGroupId: groupJid, waUserId, error }), "failed to resolve sender admin");
    return undefined;
  }
};

const refreshBotAdminState = async (input: {
  waGroupId: string;
  tenantId?: string;
  groupName?: string | null;
  force?: boolean;
  origin?: string;
  guardSource?: string;
  operationFirst?: boolean;
}) => {
  const existing =
    input.tenantId && input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
  const status = await ensureBotAdminStatus(input.waGroupId, {
    forceRefresh: input.force,
    operationFirst: input.operationFirst,
    reason: input.origin
  });
  let persistedAfter = existing?.botIsAdmin;

  const shouldPersist = status.source === "live" || status.source === "operation";
  if (shouldPersist && input.tenantId && typeof status.isAdmin === "boolean") {
    const updated = await groupAccessRepository.getGroupAccess({
      tenantId: input.tenantId,
      waGroupId: input.waGroupId,
      groupName: input.groupName ?? undefined,
      botIsAdmin: status.isAdmin
    });
    persistedAfter = updated.botIsAdmin;
  }

  if (process.env.NODE_ENV !== "production") {
    const botJidRaw = status.botJidRaw ?? socket?.user?.id;
    const botJidNormalized = status.botJidNormalized ?? (botJidRaw ? normalizeJid(botJidRaw) : undefined);
    logger.debug(
      withCategory("SYSTEM", {
        waGroupId: input.waGroupId,
        origin: input.origin ?? "refreshBotAdminState",
        guardSource: input.guardSource,
        botJidRaw,
        botJidNormalized,
        metadataFetched: Boolean(status.metadataFetched),
        participantFound: Boolean(status.participantFound),
        participantAdmin: status.participantAdmin,
        participantAdminLabel: status.participantAdminLabel,
        source: status.source,
        liveIsAdmin: status.isAdmin,
        persistedBefore: existing?.botIsAdmin,
        persistedAfter,
        error: status.error ?? status.metadataError ?? status.actionErrorMessage,
        metadataError: status.metadataError,
        actionResultKind: status.actionResultKind,
        actionErrorMessage: status.actionErrorMessage,
        checkedAt: new Date(status.checkedAt).toISOString()
      }),
      "bot admin detection"
    );
  }

  return status;
};

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
      const rawText = getText(message.message);
      const text = rawText.trim();
      const mediaPresent = hasMedia(message.message);
      if (!text && !mediaPresent) continue;
      const botJid = socket.user?.id ? normalizeJid(socket.user.id) : undefined;
      setBotSelfLidKey(botJid);
      const storedBotLid = await getBotSelfLid();
      const contextInfo = getContextInfo(message.message);
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
      const adminCommand = isGroup && text.startsWith("/") && isBotAdminCommand(text);
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
        if (action.kind === "group_admin_action") {
          const to = remoteJid;
          let replyText = "";
          let inferredBotAdmin: boolean | undefined;
          let success = false;

          if (!socket) {
            replyText = "Socket não pronto para executar a ação de admin.";
          } else {
            const sock = socket as any;
            const op = action.operation;
            const run = async () => {
              if (op === "set_subject") return sock.groupUpdateSubject(remoteJid, action.text ?? "");
              if (op === "set_description") return sock.groupUpdateDescription(remoteJid, action.text ?? "");
              if (op === "set_open") return sock.groupSettingUpdate(remoteJid, "not_announcement");
              if (op === "set_closed") return sock.groupSettingUpdate(remoteJid, "announcement");
              if (op === "set_picture_from_quote") {
                const quoted = contextInfo?.quotedMessage;
                if (!quoted) throw new Error("quoted_image_missing");
                const quotedKey = {
                  remoteJid,
                  id: action.quotedWaMessageId ?? quotedWaMessageId ?? message.key.id ?? `${Date.now()}`,
                  fromMe: false,
                  participant: quotedWaUserId ?? undefined
                };
                const buffer = await downloadMediaMessage(
                  { key: quotedKey, message: quoted } as any,
                  "buffer",
                  {},
                  { logger: baileysLogger, reuploadRequest: sock.updateMediaMessage }
                );
                return sock.updateProfilePicture(remoteJid, buffer as any, "image");
              }
              throw new Error("operacao_nao_suportada");
            };

            const opResult = await attemptGroupAdminAction({ actionName: action.operation, groupJid: remoteJid, run });
            inferredBotAdmin =
              opResult.kind === "success"
                ? true
                : opResult.kind === "failed_not_admin" || opResult.kind === "failed_not_authorized"
                  ? false
                  : undefined;
            success = opResult.kind === "success";

            if (success && context.group) {
              const settings =
                op === "set_subject"
                  ? { groupName: action.text ?? context.group.name }
                  : op === "set_description"
                    ? { description: action.text ?? null }
                    : op === "set_open"
                      ? { isOpen: true }
                      : op === "set_closed"
                        ? { isOpen: false }
                        : {};
              if (Object.keys(settings).length > 0) {
                await groupAccessRepository.updateSettings({
                  tenantId: context.tenant.id,
                  waGroupId: remoteJid,
                  actor: action.actorWaUserId,
                  settings
                });
              }
            }

            switch (op) {
              case "set_subject":
                replyText = success ? `Nome do grupo atualizado para \"${action.text}\".` : `Não consegui alterar o nome: ${opResult.errorMessage ?? opResult.kind}.`;
                break;
              case "set_description":
                replyText = success ? "Descrição do grupo atualizada." : `Não consegui alterar a descrição: ${opResult.errorMessage ?? opResult.kind}.`;
                break;
              case "set_open":
                replyText = success ? "Grupo reaberto. Todos podem enviar mensagens." : `Não consegui reabrir: ${opResult.errorMessage ?? opResult.kind}.`;
                break;
              case "set_closed":
                replyText = success ? "Grupo fechado. Apenas admins podem enviar mensagens." : `Não consegui fechar: ${opResult.errorMessage ?? opResult.kind}.`;
                break;
              case "set_picture_from_quote":
                if (opResult.kind === "success") replyText = "Foto do grupo atualizada.";
                else if (opResult.errorMessage === "quoted_image_missing") replyText = "Responda a uma imagem para usar como foto.";
                else replyText = `Não consegui atualizar a foto: ${opResult.errorMessage ?? opResult.kind}.`;
                break;
              default:
                replyText = success ? "Ação concluída." : "Ação não concluída.";
            }

            if (context.group && inferredBotAdmin !== undefined) {
              await groupAccessRepository.getGroupAccess({
                tenantId: context.tenant.id,
                waGroupId: remoteJid,
                groupName: context.group?.name ?? remoteJid,
                botIsAdmin: inferredBotAdmin
              });
            }
          }

          const sent = await sendWithReplyFallback({
            to,
            content: { text: replyText },
            quotedMessage: message,
            logContext: {
              tenantId: event.tenantId,
              scope: "group",
              action: "group_admin_action",
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
            text: replyText,
            waMessageId: sent.key.id,
            rawJson: sent
          });
          logger.info(
            withCategory("WA-OUT", {
              tenantId: event.tenantId,
              scope: "group",
              waUserId,
              phoneNumber: canonical?.phoneNumber,
              normalizedPhone,
              permissionRole,
              relationshipProfile,
              waGroupId: event.waGroupId,
              waMessageId: sent.key.id,
              action: "group_admin_action",
              textPreview: replyText.slice(0, 80)
            }),
            "outbound message"
          );
          continue;
        }
        if (action.kind === "moderation_action") {
          let replyText = "";
          let inferredBotAdmin: boolean | undefined;
          let shouldPersist = true;
          let success = true;
          let resultLabel = "";
          const sock = socket as any;
          if (action.action === "delete_message") {
            if (socket && action.messageKey) {
              try {
                await sock.sendMessage(event.waGroupId ?? remoteJid, { delete: action.messageKey } as any);
              } catch (error) {
                logger.warn(withCategory("WARN", { action: "delete_message", waGroupId: event.waGroupId, error }), "failed to delete message");
                success = false;
                resultLabel = "delete_failed";
              }
            }
            shouldPersist = false;
            replyText = "";
          } else if (action.action === "hidetag") {
            const meta = socket ? await socket.groupMetadata(event.waGroupId ?? remoteJid) : null;
            const mentions = meta?.participants?.map((p: any) => normalizeJid(p.id)) ?? [];
            const sent = await sendWithReplyFallback({
              to: event.waGroupId ?? remoteJid,
              content: { text: action.text ?? "", mentions },
              quotedMessage: message,
              logContext: {
                tenantId: event.tenantId,
                scope: "group",
                action: "hidetag",
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
              text: action.text ?? "",
              waMessageId: sent.key.id,
              rawJson: sent
            });
            logger.info(
              withCategory("WA-OUT", {
                tenantId: event.tenantId,
                scope: "group",
                waUserId,
                phoneNumber: canonical?.phoneNumber,
                normalizedPhone,
                permissionRole,
                relationshipProfile,
                waGroupId: event.waGroupId,
                waMessageId: sent.key.id,
                action: "hidetag",
                textPreview: (action.text ?? "").slice(0, 80)
              }),
              "outbound message"
            );
            resultLabel = "hidetag";
            continue;
          } else if (action.action === "ban" || action.action === "kick") {
            const target = action.targetWaUserId ? normalizeJid(action.targetWaUserId) : undefined;
            if (!target) {
              replyText = "Usuário alvo não informado.";
              success = false;
            } else if (!socket) {
              replyText = "Socket não pronto para moderar.";
              success = false;
            } else {
              const opResult = await attemptGroupAdminAction({
                actionName: action.action,
                groupJid: event.waGroupId ?? remoteJid,
                run: () => sock.groupParticipantsUpdate(event.waGroupId ?? remoteJid, [target], "remove")
              });
              inferredBotAdmin =
                opResult.kind === "success"
                  ? true
                  : opResult.kind === "failed_not_admin" || opResult.kind === "failed_not_authorized"
                    ? false
                    : undefined;
              replyText =
                opResult.kind === "success"
                  ? `Usuário ${target} removido.`
                  : `Não consegui remover: ${opResult.errorMessage ?? opResult.kind}.`;
              success = opResult.kind === "success";
              resultLabel = opResult.kind;
            }
          } else if (action.action === "mute") {
            const target = action.targetWaUserId ? normalizeJid(action.targetWaUserId) : undefined;
            if (!target || !action.durationMs) {
              replyText = "Informe usuário e duração para aplicar mute.";
              success = false;
            } else {
              const until = await muteAdapter.mute({
                tenantId: context.tenant.id,
                scope: "GROUP",
                scopeId: event.waGroupId ?? remoteJid,
                waUserId: target,
                durationMs: action.durationMs,
                now: new Date()
              });
              const fmt = new Intl.DateTimeFormat("pt-BR", {
                timeZone: env.BOT_TIMEZONE,
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              }).format(until.until);
              replyText = `Usuário ${target} silenciado até ${fmt}.`;
              resultLabel = "muted";
            }
          } else if (action.action === "unmute") {
            const target = action.targetWaUserId ? normalizeJid(action.targetWaUserId) : undefined;
            if (!target) {
              replyText = "Informe quem deve ser reativado.";
              success = false;
            } else {
              await muteAdapter.unmute({ tenantId: context.tenant.id, scope: "GROUP", scopeId: event.waGroupId ?? remoteJid, waUserId: target });
              replyText = `Silêncio removido para ${target}.`;
              resultLabel = "unmuted";
            }
          }

          if (!replyText && !shouldPersist) continue;

          if (context.group && inferredBotAdmin !== undefined) {
            await groupAccessRepository.getGroupAccess({
              tenantId: context.tenant.id,
              waGroupId: remoteJid,
              groupName: context.group?.name ?? remoteJid,
              botIsAdmin: inferredBotAdmin
            });
          }

          const sent = await sendWithReplyFallback({
            to: event.waGroupId ?? remoteJid,
            content: { text: replyText },
            quotedMessage: message,
            logContext: {
              tenantId: event.tenantId,
              scope: "group",
              action: action.action,
              waUserId,
              waGroupId: event.waGroupId
            }
          });
          if (shouldPersist) {
            await persistOutboundMessage({
              tenantId: context.tenant.id,
              userId: context.user.id,
              groupId: context.group?.id,
              waUserId,
              waGroupId: event.waGroupId,
              text: replyText,
              waMessageId: sent.key.id,
              rawJson: sent
            });
          }
          logger.info(
            withCategory("WA-OUT", {
              tenantId: event.tenantId,
              scope: "group",
              waUserId,
              phoneNumber: canonical?.phoneNumber,
              normalizedPhone,
              permissionRole,
              relationshipProfile,
              waGroupId: event.waGroupId,
              waMessageId: sent.key.id,
              action: action.action,
              textPreview: replyText.slice(0, 80)
            }),
            "outbound message"
          );
          await metrics.increment("moderation_actions_total");
          await auditTrail.record({
            kind: "moderation",
            tenantId: event.tenantId,
            waUserId,
            waGroupId: event.waGroupId,
            action: action.action,
            targetWaUserId: action.targetWaUserId,
            success,
            result: resultLabel || replyText || undefined
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
