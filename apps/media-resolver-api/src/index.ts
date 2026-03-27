import {
  createMediaDownloadRouter,
  createRedisConnection
} from "@zappy/adapters";
import {
  createLogger,
  loadEnv,
  printStartupBanner
} from "@zappy/shared";
import { createMediaResolverService } from "./application/resolver-service.js";
import { startInternalMediaResolverApi } from "./infrastructure/internal-media-resolver-api.js";

const env = loadEnv();
const logger = createLogger("media-resolver-api");
const redis = createRedisConnection(env.REDIS_URL);

const mediaDownload = createMediaDownloadRouter({
  direct: {
    timeoutMs: env.DOWNLOADS_DIRECT_TIMEOUT_MS
  },
  instagram: {
    logger
  },
  youtube: {
    logger,
    complianceMode: "prepare_only",
    apiKey: env.YOUTUBE_API_KEY
  },
  facebook: {
    logger,
    complianceMode: "prepare_only",
    accessToken: env.FACEBOOK_ACCESS_TOKEN,
    graphApiVersion: env.FACEBOOK_GRAPH_API_VERSION
  },
  logger
});

const resolverService = await createMediaResolverService({
  mediaDownload,
  redis,
  logger,
  tempDir: env.MEDIA_RESOLVER_TEMP_DIR,
  jobTtlSeconds: env.MEDIA_RESOLVER_JOB_TTL_SECONDS,
  maxRetryAttempts: 2
});

printStartupBanner(logger, {
  app: "Media Resolver API",
  environment: env.NODE_ENV,
  timezone: env.BOT_TIMEZONE,
  llmEnabled: false,
  model: undefined,
  adminApiUrl: `http://localhost:${env.ADMIN_API_PORT}`,
  adminUiUrl: `http://localhost:${env.ADMIN_UI_PORT}`,
  queueName: env.QUEUE_NAME,
  redisStatus: "PENDING",
  dbStatus: "PENDING",
  workerStatus: "PENDING",
  llmStatus: undefined,
  extras: {
    mediaResolverPort: env.MEDIA_RESOLVER_API_PORT,
    mediaResolverBaseUrl: env.MEDIA_RESOLVER_API_BASE_URL,
    mediaResolverJobTtlSeconds: env.MEDIA_RESOLVER_JOB_TTL_SECONDS,
    mediaResolverCleanupIntervalMs: env.MEDIA_RESOLVER_CLEANUP_INTERVAL_MS,
    mediaResolverTempDir: env.MEDIA_RESOLVER_TEMP_DIR
  }
});

const reportStartupStatus = async () => {
  const redisOk = await redis
    .ping()
    .then(() => true)
    .catch(() => false);

  logger.info(
    {
      category: "SYSTEM",
      target: "Redis",
      status: redisOk ? "OK" : "FAIL"
    },
    redisOk ? "Redis OK" : "Redis FAIL"
  );
};

const server = startInternalMediaResolverApi({
  port: env.MEDIA_RESOLVER_API_PORT,
  token: env.MEDIA_RESOLVER_API_TOKEN,
  logger,
  resolveMedia: resolverService.resolve
});

void reportStartupStatus();
void resolverService.runExpiredTempCleanup().catch((error) => {
  logger.warn?.(
    {
      capability: "downloads",
      status: "temp_cleanup_failed",
      error
    },
    "initial temp cleanup failed"
  );
});

const cleanupTimer = setInterval(() => {
  void resolverService.runExpiredTempCleanup().catch((error) => {
    logger.warn?.(
      {
        capability: "downloads",
        status: "temp_cleanup_failed",
        error
      },
      "periodic temp cleanup failed"
    );
  });
}, env.MEDIA_RESOLVER_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

const shutdown = async () => {
  logger.info({ category: "SYSTEM", status: "shutdown" }, "shutting down media resolver api");
  clearInterval(cleanupTimer);
  await server.close().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("unhandledRejection", (reason) => {
  logger.error?.({ category: "ERROR", err: reason }, "unhandled rejection");
});
process.on("uncaughtException", (error) => {
  logger.error?.({ category: "ERROR", err: error }, "uncaught exception");
});
