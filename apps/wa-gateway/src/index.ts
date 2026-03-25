import { downloadMediaMessage } from "baileys";
import { Orchestrator } from "@zappy/core";
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
import { buildBotAliases, jidMatchesBot, normalizeJid, normalizeLidJid, stripUser } from "./bot-alias.js";
import { startInternalDispatchApi } from "./infrastructure/internal-dispatch-api.js";
import { createCommandGuards } from "./infrastructure/command-guards.js";
import { getInboundContextInfo, getInboundText, hasInboundMedia } from "./infrastructure/inbound-message.js";
import { createBotSelfLidService } from "./infrastructure/bot-self-lid.js";
import { createBotAdminStatusService, GROUP_ADMIN_OPERATION_CACHE_TTL_MS } from "./infrastructure/bot-admin-status.js";
import { createBaileysRuntimeLogger } from "./infrastructure/baileys-runtime-logger.js";
import { executeOutboundActions } from "./infrastructure/outbound-actions.js";
import { createGroupParticipantsUpdateHandler } from "./inbound/group-participants-handler.js";
import { createMessagesUpsertHandler } from "./inbound/messages-upsert-handler.js";
import { wireInboundEvents } from "./inbound/event-wiring.js";
import { createWhatsAppConnector } from "./bootstrap/connect-whatsapp.js";

const env = loadEnv();
const logger = createLogger("wa-gateway");
const rawBaileysLogger = logger.child({ name: "baileys", module: "baileys" }, { level: process.env.DEBUG === "trace" ? "debug" : "warn" });
const baileysLogger = createBaileysRuntimeLogger({
  baseLogger: rawBaileysLogger as any,
  appLogger: logger as any,
  withCategory
});
const redis = createRedisConnection(env.REDIS_URL);
const metrics = createMetricsRecorder(redis);
const queue = createQueue(env.QUEUE_NAME, env.REDIS_URL);
const queueAdapter = createQueueAdapter(queue);
const INBOUND_MESSAGE_CLAIM_TTL_SECONDS = 120;
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

let socket: any | null = null;
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

const getSocket = () => socket;

const handleGroupParticipantsUpdate = createGroupParticipantsUpdateHandler({
  getSocket,
  prisma,
  normalizeJid,
  stripUser,
  refreshBotAdminState,
  ensureTenantContext,
  groupAccessRepository,
  sendWithReplyFallback,
  persistOutboundMessage,
  logger,
  withCategory,
  env: {
    DEFAULT_TENANT_NAME: env.DEFAULT_TENANT_NAME,
    ONLY_GROUP_ID: env.ONLY_GROUP_ID
  }
});

const handleMessagesUpsert = createMessagesUpsertHandler({
  orchestrator,
  env: {
    ONLY_GROUP_ID: env.ONLY_GROUP_ID,
    DEFAULT_TENANT_NAME: env.DEFAULT_TENANT_NAME,
    BOT_TIMEZONE: env.BOT_TIMEZONE,
    INBOUND_MAX_MESSAGE_AGE_SECONDS: env.INBOUND_MAX_MESSAGE_AGE_SECONDS
  },
  getSocket,
  normalizeJid,
  buildBotAliases,
  jidMatchesBot: (candidate, botAlias) => jidMatchesBot(candidate ?? undefined, botAlias ?? undefined),
  getInboundText,
  hasInboundMedia,
  getInboundContextInfo,
  setBotSelfLidKey,
  getBotSelfLid,
  maybeLearnBotLidFromQuote,
  ensureTenantContext,
  isBotAdminCommand,
  resolveSenderGroupAdmin,
  refreshBotAdminState,
  groupAdminOperationCacheTtlMs: GROUP_ADMIN_OPERATION_CACHE_TTL_MS,
  claimInboundMessage: async ({ remoteJid, waMessageId }) => {
    const claimKey = `wa:inbound:claim:${normalizeJid(remoteJid)}:${waMessageId}`;
    const claimed = await redis.set(claimKey, "1", "EX", INBOUND_MESSAGE_CLAIM_TTL_SECONDS, "NX");
    return claimed === "OK";
  },
  inboundMessageClaimTtlSeconds: INBOUND_MESSAGE_CLAIM_TTL_SECONDS,
  persistInboundMessage,
  logger,
  withCategory,
  executeOutboundActions,
  outboundRuntime: {
    sendWithReplyFallback,
    persistOutboundMessage,
    queueAdapter,
    groupAccessRepository,
    muteAdapter,
    attemptGroupAdminAction,
    downloadMediaMessage,
    baileysLogger,
    metrics,
    auditTrail,
    stickerMaxVideoSeconds: env.STICKER_MAX_VIDEO_SECONDS
  }
});

const { connect } = createWhatsAppConnector({
  env: {
    WA_SESSION_PATH: env.WA_SESSION_PATH,
    WA_PAIRING_PHONE: process.env.WA_PAIRING_PHONE
  },
  logger,
  baileysLogger,
  normalizeJid,
  setSocket: (nextSocket) => {
    socket = nextSocket;
  },
  setBotSelfLidKey,
  loadBotSelfLid,
  learnBotSelfLid,
  markGatewayHeartbeat: async (isConnected: boolean) => markGatewayHeartbeat(redis, isConnected),
  withCategory,
  wireInboundEvents: (activeSocket) => {
    wireInboundEvents({
      socket: activeSocket,
      onMessagesUpsert: handleMessagesUpsert,
      onGroupParticipantsUpdate: handleGroupParticipantsUpdate
    });
  }
});

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
