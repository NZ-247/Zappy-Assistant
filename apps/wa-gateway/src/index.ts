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
  createOpenAiSpeechToTextAdapter,
  createOpenAiTextToSpeechAdapter,
  createOpenAiTranslationAdapter,
  createWebSearchAdapter,
  createOpenAiSearchAiAdapter,
  createGeminiSearchAiAdapter,
  createImageSearchAdapter,
  createInternalMediaResolverClient,
  createConversationStateAdapter,
  conversationMemoryRepository,
  consentRepository,
  groupAccessRepository,
  botAdminRepository,
  governancePort as _baseGovernancePort,
  createCachedGovernancePort
} from "@zappy/adapters";
import { AiService, buildBaseSystemPrompt } from "@zappy/ai";
import {
  createLogger,
  loadEnv,
  printStartupBanner,
  withCategory,
  type InternalGatewaySendTextRequest
} from "@zappy/shared";
import { buildBotAliases, jidMatchesBot, normalizeJid, normalizeLidJid, stripUser } from "./bot-alias.js";
import { startInternalDispatchApi } from "./infrastructure/internal-dispatch-api.js";
import { createCommandGuards } from "./infrastructure/command-guards.js";
import { getInboundAudioMessage, getInboundContextInfo, getInboundMessageType, getInboundText, hasInboundMedia } from "./infrastructure/inbound-message.js";
import { createBotSelfLidService } from "./infrastructure/bot-self-lid.js";
import { createBotAdminStatusService, GROUP_ADMIN_OPERATION_CACHE_TTL_MS } from "./infrastructure/bot-admin-status.js";
import { createBaileysRuntimeLogger } from "./infrastructure/baileys-runtime-logger.js";
import { executeOutboundActions } from "./infrastructure/outbound-actions.js";
import { resolveOutboundTarget } from "./infrastructure/outbound/target-normalization.js";
import { createGroupParticipantsUpdateHandler } from "./inbound/group-participants-handler.js";
import { createMessagesUpsertHandler } from "./inbound/messages-upsert-handler.js";
import { createGovernanceRuntimeEvaluator } from "./inbound/governance-shadow.js";
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
const governancePort = createCachedGovernancePort(_baseGovernancePort, redis);
const metrics = createMetricsRecorder(redis);
const queue = createQueue(env.QUEUE_NAME, env.REDIS_URL);
const queueAdapter = createQueueAdapter(queue);
const INBOUND_MESSAGE_CLAIM_TTL_SECONDS = env.INBOUND_MESSAGE_CLAIM_TTL_SECONDS;
const INBOUND_STARTUP_WATERMARK_MS = Date.now();
const INBOUND_STARTUP_WATERMARK_ISO = new Date(INBOUND_STARTUP_WATERMARK_MS).toISOString();
const INBOUND_STARTUP_SESSION_ID = `wa-gateway-${process.pid}-${INBOUND_STARTUP_WATERMARK_MS.toString(36)}`;
const INBOUND_WATERMARK_REDIS_TTL_SECONDS = Math.max(3600, INBOUND_MESSAGE_CLAIM_TTL_SECONDS);
const INBOUND_STARTUP_WATERMARK_KEY = `wa:inbound:startup-watermark:${INBOUND_STARTUP_SESSION_ID}`;
const llmConfigured = Boolean(env.OPENAI_API_KEY);
const llmModel = env.LLM_MODEL ?? env.OPENAI_MODEL;
const baseSystemPrompt = buildBaseSystemPrompt({
  personaId: env.LLM_PERSONA,
  settings: { timezone: env.BOT_TIMEZONE },
  policyNotes: ["Priorize o contexto do chat atual."]
});
const llmAdapter = createOpenAiAdapter(env.OPENAI_API_KEY, llmModel);
const speechToTextAdapter = createOpenAiSpeechToTextAdapter({
  apiKey: env.OPENAI_API_KEY,
  model: env.AUDIO_STT_MODEL,
  timeoutMs: env.AUDIO_STT_TIMEOUT_MS,
  language: env.AUDIO_STT_LANGUAGE
});
const textToSpeechAdapter = env.TTS_ENABLED
  ? createOpenAiTextToSpeechAdapter({
      apiKey: env.OPENAI_API_KEY,
      model: env.TTS_MODEL,
      timeoutMs: env.TTS_TIMEOUT_MS,
      format: env.TTS_AUDIO_FORMAT,
      voices: {
        male: env.TTS_MALE_VOICE,
        female: env.TTS_FEMALE_VOICE,
        default: env.TTS_DEFAULT_VOICE
      }
    })
  : undefined;
const textTranslationAdapter = createOpenAiTranslationAdapter({
  apiKey: env.OPENAI_API_KEY,
  model: env.TTS_TRANSLATION_MODEL,
  timeoutMs: env.TTS_TRANSLATION_TIMEOUT_MS
});
const googleSearchEngineId = env.GOOGLE_SEARCH_ENGINE_ID ?? env.GOOGLE_SEARCH_CX;
const webSearchAdapter = env.SEARCH_ENABLED
  ? createWebSearchAdapter({
      googleApiKey: env.GOOGLE_SEARCH_API_KEY,
      googleSearchEngineId,
      googleCx: env.GOOGLE_SEARCH_CX,
      timeoutMs: env.SEARCH_TIMEOUT_MS,
      preferredProvider: env.SEARCH_PROVIDER
    })
  : undefined;
const searchAiAdapter = env.SEARCH_AI_ENABLED
  ? env.SEARCH_AI_PROVIDER === "gemini"
    ? createGeminiSearchAiAdapter({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_SEARCH_AI_MODEL,
        timeoutMs: env.SEARCH_AI_TIMEOUT_MS,
        maxSources: env.SEARCH_AI_MAX_SOURCES,
        useGoogleSearchGrounding: env.GEMINI_SEARCH_GROUNDING_ENABLED
      })
    : createOpenAiSearchAiAdapter({
        apiKey: env.OPENAI_API_KEY,
        model: env.SEARCH_AI_MODEL,
        timeoutMs: env.SEARCH_AI_TIMEOUT_MS,
        maxSources: env.SEARCH_AI_MAX_SOURCES
      })
  : undefined;
const imageSearchAdapter = env.IMAGE_SEARCH_ENABLED
  ? createImageSearchAdapter({
      googleApiKey: env.GOOGLE_SEARCH_API_KEY,
      googleSearchEngineId,
      googleCx: env.GOOGLE_SEARCH_CX,
      openverseApiBaseUrl: env.OPENVERSE_API_BASE_URL,
      pixabayApiKey: env.PIXABAY_API_KEY,
      pexelsApiKey: env.PEXELS_API_KEY,
      unsplashAccessKey: env.UNSPLASH_ACCESS_KEY,
      timeoutMs: env.SEARCH_TIMEOUT_MS,
      preferredProvider: env.IMAGE_SEARCH_PROVIDER,
      mediaNormalizationEnabled: env.IMAGE_SEARCH_MEDIA_NORMALIZE_ENABLED,
      mediaNormalizationMaxDimension: env.IMAGE_SEARCH_MEDIA_NORMALIZE_MAX_DIMENSION,
      mediaNormalizationJpegQuality: env.IMAGE_SEARCH_MEDIA_NORMALIZE_JPEG_QUALITY,
      mediaNormalizationTriggerBytes: env.IMAGE_SEARCH_MEDIA_NORMALIZE_TRIGGER_BYTES,
      ...({ logger } as any)
    })
  : undefined;
const mediaDownloadAdapter = env.DOWNLOADS_MODULE_ENABLED
  ? createInternalMediaResolverClient({
      baseUrl: env.MEDIA_RESOLVER_API_BASE_URL,
      token: env.MEDIA_RESOLVER_API_TOKEN,
      logger,
      timeoutMs: 30_000
    })
  : undefined;
const audioCommandAllowlist = env.AUDIO_COMMAND_ALLOWLIST.split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const governanceShadowMode = env.GOVERNANCE_SHADOW_MODE;
const governanceEnforcementEnabled = env.GOVERNANCE_ENFORCEMENT_ENABLED;
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
    internalDispatchPort: env.WA_GATEWAY_INTERNAL_PORT,
    mediaResolverBaseUrl: env.MEDIA_RESOLVER_API_BASE_URL,
    inboundClaimTtlSeconds: INBOUND_MESSAGE_CLAIM_TTL_SECONDS,
    inboundStartupSession: INBOUND_STARTUP_SESSION_ID,
    governanceShadowMode,
    governanceEnforcementEnabled
  }
});

void redis
  .set(INBOUND_STARTUP_WATERMARK_KEY, String(INBOUND_STARTUP_WATERMARK_MS), "EX", INBOUND_WATERMARK_REDIS_TTL_SECONDS)
  .then(() => {
    logger.info(
      withCategory("SYSTEM", {
        status: "inbound_replay_guard_ready",
        startupSessionId: INBOUND_STARTUP_SESSION_ID,
        startupWatermark: INBOUND_STARTUP_WATERMARK_ISO,
        claimTtlSeconds: INBOUND_MESSAGE_CLAIM_TTL_SECONDS
      }),
      "inbound replay guard ready"
    );
  })
  .catch((error) => {
    logger.warn(
      withCategory("WARN", {
        status: "inbound_replay_guard_watermark_persist_failed",
        startupSessionId: INBOUND_STARTUP_SESSION_ID,
        error
      }),
      "inbound replay guard watermark persist failed"
    );
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
  const target = resolveOutboundTarget(to);
  if (target.normalizationApplied) {
    logger.debug(
      withCategory("WA-OUT", {
        ...logContext,
        status: "outbound_target_normalized",
        requestedTo: to,
        normalizedTo: target.normalizedTo
      }),
      "normalized outbound target before WA send"
    );
  }

  if (quotedMessage) {
    try {
      return await socket.sendMessage(target.normalizedTo, content, { quoted: quotedMessage });
    } catch (error) {
      logger.debug(
        withCategory("WA-OUT", {
          ...logContext,
          error,
          replyTo: quotedMessage?.key?.id,
          requestedTo: to,
          normalizedTo: target.normalizedTo,
          note: "quoted_send_failed"
        }),
        "quoted send failed; falling back without reply context"
      );
    }
  } else {
    logger.debug(withCategory("WA-OUT", { ...logContext, note: "quoted_message_missing" }), "no quoted message available; sending without reply context");
  }
  return socket.sendMessage(target.normalizedTo, content);
};

const dispatchInternalText = async (input: InternalGatewaySendTextRequest): Promise<{ waMessageId: string; raw?: unknown }> => {
  const target = resolveOutboundTarget(input.to);
  const scope = input.waGroupId || target.scope === "group" ? "group" : "direct";
  const outboundWaUserId = scope === "direct" ? target.normalizedTo : input.waUserId ?? input.to;
  const sent = await sendWithReplyFallback({
    to: target.normalizedTo,
    content: { text: input.text },
    quotedMessage: undefined,
    logContext: {
      tenantId: input.tenantId,
      scope,
      action: input.action,
      referenceId: input.referenceId,
      waUserId: outboundWaUserId,
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
      waUserId: outboundWaUserId,
      waGroupId: input.waGroupId,
      requestedTargetId: input.to,
      normalizedTargetId: target.normalizedTo,
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
  dispatchText: dispatchInternalText,
  onListening: () => process.send?.("ready")
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
  textToSpeech: textToSpeechAdapter,
  textTranslation: textTranslationAdapter,
  webSearch: webSearchAdapter,
  searchAi: searchAiAdapter,
  imageSearch: imageSearchAdapter,
  mediaDownload: mediaDownloadAdapter,
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
  ttsEnabled: env.TTS_ENABLED,
  ttsDefaultSourceLanguage: env.TTS_DEFAULT_SOURCE_LANGUAGE,
  ttsDefaultLanguage: env.TTS_DEFAULT_LANGUAGE,
  ttsDefaultVoice: env.TTS_DEFAULT_VOICE,
  ttsMaxTextChars: env.TTS_MAX_TEXT_CHARS,
  ttsSendAsPtt: env.TTS_SEND_AS_PTT,
  searchResultsLimit: env.SEARCH_MAX_RESULTS,
  searchAiEnabled: env.SEARCH_AI_ENABLED,
  searchAiMaxSources: env.SEARCH_AI_MAX_SOURCES,
  imageSearchResultsLimit: env.IMAGE_SEARCH_MAX_RESULTS,
  audioCapabilityEnabled: env.AUDIO_CAPABILITY_ENABLED,
  audioAutoTranscribeEnabled: env.AUDIO_AUTO_TRANSCRIBE_ENABLED,
  audioCommandDispatchEnabled: env.AUDIO_COMMAND_DISPATCH_ENABLED,
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
const evaluateGovernanceDecision = createGovernanceRuntimeEvaluator({
  governancePort,
  logger,
  withCategory,
  commandPrefix: env.BOT_PREFIX,
  consentTermsVersion: env.CONSENT_TERMS_VERSION,
  freeDirectChatLimit: env.GOVERNANCE_FREE_DIRECT_CHAT_LIMIT,
  shadowEnabled: governanceShadowMode,
  enforcementEnabled: governanceEnforcementEnabled
});

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
    INBOUND_MAX_MESSAGE_AGE_SECONDS: env.INBOUND_MAX_MESSAGE_AGE_SECONDS,
    INBOUND_STARTUP_WATERMARK_TOLERANCE_SECONDS: env.INBOUND_STARTUP_WATERMARK_TOLERANCE_SECONDS,
    INBOUND_MISSING_TIMESTAMP_STARTUP_GRACE_SECONDS: env.INBOUND_MISSING_TIMESTAMP_STARTUP_GRACE_SECONDS
  },
  startupWatermarkMs: INBOUND_STARTUP_WATERMARK_MS,
  startupWatermarkIso: INBOUND_STARTUP_WATERMARK_ISO,
  startupSessionId: INBOUND_STARTUP_SESSION_ID,
  getSocket,
  normalizeJid,
  buildBotAliases,
  jidMatchesBot: (candidate, botAlias) => jidMatchesBot(candidate ?? undefined, botAlias ?? undefined),
  getInboundText,
  getInboundMessageType,
  hasInboundMedia,
  getInboundAudioMessage,
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
  evaluateGovernanceDecision,
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
    stickerMaxVideoSeconds: env.STICKER_MAX_VIDEO_SECONDS,
    commandPrefix: env.BOT_PREFIX,
    progressReactions: {
      enabled: env.WA_REACTIONS_ENABLED,
      processingEmoji: env.WA_REACTION_PROGRESS,
      successEmoji: env.WA_REACTION_SUCCESS,
      failureEmoji: env.WA_REACTION_FAILURE
    },
    audioConfig: {
      enabled: env.AUDIO_CAPABILITY_ENABLED,
      sttModel: env.AUDIO_STT_MODEL,
      sttTimeoutMs: env.AUDIO_STT_TIMEOUT_MS,
      maxDurationSeconds: env.AUDIO_MAX_DURATION_SECONDS,
      maxBytes: env.AUDIO_MAX_BYTES,
      language: env.AUDIO_STT_LANGUAGE,
      commandDispatchEnabled: env.AUDIO_COMMAND_DISPATCH_ENABLED,
      commandPrefix: env.BOT_PREFIX,
      commandAllowlist: audioCommandAllowlist,
      commandMinConfidence: env.AUDIO_COMMAND_MIN_CONFIDENCE,
      transcriptPreviewChars: env.AUDIO_TRANSCRIPT_PREVIEW_CHARS
    },
    speechToText: speechToTextAdapter
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
