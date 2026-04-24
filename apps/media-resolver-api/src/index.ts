import {
  createMediaDownloadRouter,
  createDirectDownloadProvider,
  createFacebookDownloadProvider,
  createInstagramDownloadProvider,
  createYoutubeDownloadProvider,
  createRedisConnection
} from "@zappy/adapters";
import {
  createLogger,
  loadEnv,
  printStartupBanner
} from "@zappy/shared";
import { createMediaResolverService } from "./application/resolver-service.js";
import { startInternalMediaResolverApi } from "./infrastructure/internal-media-resolver-api.js";
import { createYoutubeServiceBridgeProvider } from "./infrastructure/providers/youtube-service-bridge-provider.js";
import { createFacebookServiceBridgeProvider } from "./infrastructure/providers/facebook-service-bridge-provider.js";

const env = loadEnv();
const logger = createLogger("media-resolver-api");
const redis = createRedisConnection(env.REDIS_URL);

type RouterInput = NonNullable<Parameters<typeof createMediaDownloadRouter>[0]>;
type RouterProviders = NonNullable<RouterInput["providers"]>;
const providerHealthChecks: Array<{ provider: "yt" | "fb"; check: () => Promise<boolean> }> = [];

const providers: RouterProviders = [];

if (env.DOWNLOADS_PROVIDER_YT_ENABLED) {
  if (env.YT_RESOLVER_ENABLED) {
    const youtubeBridge = createYoutubeServiceBridgeProvider({
      baseUrl: env.YT_RESOLVER_BASE_URL,
      token: env.YT_RESOLVER_TOKEN,
      timeoutMs: env.YT_RESOLVER_TIMEOUT_MS,
      maxBytes: env.YT_RESOLVER_MAX_BYTES,
      logger,
      metadataApiKey: env.YOUTUBE_API_KEY
    });
    providers.push(youtubeBridge.provider);
    providerHealthChecks.push({ provider: "yt", check: youtubeBridge.checkHealth });
  } else {
    providers.push(
      createYoutubeDownloadProvider({
        logger,
        complianceMode: "prepare_only",
        apiKey: env.YOUTUBE_API_KEY
      })
    );
  }
}

if (env.DOWNLOADS_PROVIDER_IG_ENABLED) {
  providers.push(
    createInstagramDownloadProvider({
      logger
    })
  );
}

if (env.DOWNLOADS_PROVIDER_FB_ENABLED) {
  if (env.FB_RESOLVER_ENABLED) {
    const facebookBridge = createFacebookServiceBridgeProvider({
      baseUrl: env.FB_RESOLVER_BASE_URL,
      token: env.FB_RESOLVER_TOKEN,
      timeoutMs: env.FB_RESOLVER_TIMEOUT_MS,
      maxBytes: env.FB_RESOLVER_MAX_BYTES,
      logger,
      metadataAccessToken: env.FACEBOOK_ACCESS_TOKEN,
      metadataGraphApiVersion: env.FACEBOOK_GRAPH_API_VERSION
    });
    providers.push(facebookBridge.provider);
    providerHealthChecks.push({ provider: "fb", check: facebookBridge.checkHealth });
  } else {
    providers.push(
      createFacebookDownloadProvider({
        logger,
        complianceMode: "prepare_only",
        accessToken: env.FACEBOOK_ACCESS_TOKEN,
        graphApiVersion: env.FACEBOOK_GRAPH_API_VERSION
      })
    );
  }
}

if (env.DOWNLOADS_PROVIDER_DIRECT_ENABLED) {
  providers.push(
    createDirectDownloadProvider({
      timeoutMs: env.DOWNLOADS_DIRECT_TIMEOUT_MS,
      maxBytes: env.DOWNLOADS_MAX_BYTES
    })
  );
}

const mediaDownload = createMediaDownloadRouter({
  providers,
  maxBytes: env.DOWNLOADS_MAX_BYTES,
  logger
});

const resolverService = await createMediaResolverService({
  mediaDownload,
  redis,
  logger,
  tempDir: env.MEDIA_RESOLVER_TEMP_DIR,
  tempRetentionSeconds: env.MEDIA_RESOLVER_TEMP_RETENTION_SECONDS,
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
    mediaResolverTempDir: env.MEDIA_RESOLVER_TEMP_DIR,
    mediaResolverTempRetentionSeconds: env.MEDIA_RESOLVER_TEMP_RETENTION_SECONDS,
    downloadsMaxBytes: env.DOWNLOADS_MAX_BYTES,
    providerYtEnabled: env.DOWNLOADS_PROVIDER_YT_ENABLED,
    providerIgEnabled: env.DOWNLOADS_PROVIDER_IG_ENABLED,
    providerFbEnabled: env.DOWNLOADS_PROVIDER_FB_ENABLED,
    providerDirectEnabled: env.DOWNLOADS_PROVIDER_DIRECT_ENABLED,
    ytResolverEnabled: env.YT_RESOLVER_ENABLED,
    fbResolverEnabled: env.FB_RESOLVER_ENABLED
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

  if (!providerHealthChecks.length) return;

  for (const healthCheck of providerHealthChecks) {
    try {
      const healthy = await healthCheck.check();
      logger.info(
        {
          capability: "downloads",
          status: healthy ? "provider_health_ok" : "provider_health_fail",
          provider: healthCheck.provider
        },
        healthy ? "provider bridge health OK" : "provider bridge health FAIL"
      );
    } catch (error) {
      logger.warn?.(
        {
          capability: "downloads",
          status: "provider_health_fail",
          provider: healthCheck.provider,
          error
        },
        "provider bridge health check failed"
      );
    }
  }
};

const server = startInternalMediaResolverApi({
  port: env.MEDIA_RESOLVER_API_PORT,
  token: env.MEDIA_RESOLVER_API_TOKEN,
  logger,
  resolveMedia: resolverService.resolve,
  onListening: () => process.send?.("ready")
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
