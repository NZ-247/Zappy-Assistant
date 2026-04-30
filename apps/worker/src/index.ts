import { Worker } from "./bullmq-compat.js";
import {
  createRedisConnection,
  markWorkerHeartbeat,
  prisma,
  createMetricsRecorder,
  createAuditTrail,
  governancePort as _baseGovernancePort,
  createCachedGovernancePort
} from "@zappy/adapters";
import { createLogger, loadEnv, printStartupBanner, withCategory } from "@zappy/shared";
import { createWaGatewayDispatchClient } from "./infrastructure/wa-gateway-dispatch-client.js";
import { processReminderJob, summarizeReminderJobError } from "./reminders/application/use-cases/process-reminder-job.js";
import { processTimerJob } from "./timers/application/use-cases/process-timer-job.js";

const env = loadEnv();
const logger = createLogger("worker");
const connection = createRedisConnection(env.REDIS_URL);
const governancePort = createCachedGovernancePort(_baseGovernancePort, connection);
const metrics = createMetricsRecorder(connection);
const auditTrail = createAuditTrail();
const gatewayClient = createWaGatewayDispatchClient({
  baseUrl: env.WA_GATEWAY_INTERNAL_BASE_URL,
  token: env.WA_GATEWAY_INTERNAL_TOKEN,
  logger
});
const heartbeat = setInterval(() => void markWorkerHeartbeat(connection), 10_000);
void markWorkerHeartbeat(connection);

printStartupBanner(logger, {
  app: "Worker",
  environment: env.NODE_ENV,
  timezone: env.BOT_TIMEZONE,
  llmEnabled: env.LLM_ENABLED,
  model: env.LLM_MODEL,
  adminApiUrl: `http://localhost:${env.ADMIN_API_PORT}`,
  adminUiUrl: `http://localhost:${env.ADMIN_UI_PORT}`,
  queueName: env.QUEUE_NAME,
  redisStatus: "PENDING",
  dbStatus: "PENDING",
  workerStatus: "PENDING",
  llmStatus: env.LLM_ENABLED ? "PENDING" : undefined,
  extras: {
    internalGatewayUrl: env.WA_GATEWAY_INTERNAL_BASE_URL
  }
});

const reportStartupStatus = async () => {
  const dbOk = await prisma
    .$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false);
  const redisOk = await connection
    .ping()
    .then(() => true)
    .catch(() => false);
  logger.info(withCategory("DB", { status: dbOk ? "OK" : "FAIL" }), `DB ${dbOk ? "OK" : "FAIL"}`);
  logger.info(withCategory("SYSTEM", { target: "Redis", status: redisOk ? "OK" : "FAIL" }), `Redis ${redisOk ? "OK" : "FAIL"}`);
};

void reportStartupStatus();

const worker = new Worker(
  env.QUEUE_NAME,
  async (job) => {
    if (job.name === "send-reminder") {
      const reminderId = String(job.data.reminderId ?? "").trim();
      if (!reminderId) {
        logger.warn(withCategory("WARN", { action: "send_reminder", jobId: job.id }), "job send-reminder missing reminderId");
        return;
      }
      await processReminderJob(reminderId, {
        logger,
        gatewayClient,
        governancePort,
        metrics,
        auditTrail,
        jobId: String(job.id ?? "") || undefined
      });
      return;
    }

    if (job.name === "fire-timer") {
      const timerId = String(job.data.timerId ?? "").trim();
      if (!timerId) {
        logger.warn(withCategory("WARN", { action: "fire_timer", jobId: job.id }), "job fire-timer missing timerId");
        return;
      }
      await processTimerJob(timerId, { logger, gatewayClient, governancePort });
      return;
    }

    logger.warn(withCategory("WARN", { jobId: job.id, jobName: job.name }), "worker received unknown job type");
  },
  { connection: connection as unknown as any }
);

worker.on("completed", (job) => logger.info(withCategory("QUEUE", { jobId: job.id }), "job completed"));
worker.on("failed", (job, error) => {
  const summarized = summarizeReminderJobError(error);
  logger.error(
    withCategory("ERROR", {
      action: "queue_job_failed",
      jobId: job?.id,
      jobName: job?.name,
      errorName: summarized.errorName,
      operatorMessage: summarized.operatorMessage
    }),
    "job failed"
  );
});

worker.on("stalled", (jobId) => {
  logger.warn(withCategory("WARN", { action: "queue_job_stalled", jobId }), "job stalled — will be retried");
});

worker.on("error", (error) => {
  logger.error(withCategory("ERROR", { action: "worker_error", err: error }), "worker connection error");
});

const shutdown = async () => {
  logger.info("shutting down worker");
  clearInterval(heartbeat);
  await worker.close();
  await connection.quit();
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

logger.info(withCategory("QUEUE", { queue: env.QUEUE_NAME, status: "Worker OK" }), "worker started");
process.send?.("ready");
