import { Worker } from "bullmq";
import {
  createRedisConnection,
  getReminderById,
  getTimerById,
  markReminderMessage,
  markTimerMessage,
  markWorkerHeartbeat,
  persistOutboundMessage,
  prisma,
  updateReminderStatus,
  updateTimerStatus
} from "@zappy/adapters";
import { ReminderStatus, TimerStatus } from "@prisma/client";
import { createLogger, loadEnv, printStartupBanner, withCategory } from "@zappy/shared";

const env = loadEnv();
const logger = createLogger("worker");
const connection = createRedisConnection(env.REDIS_URL);
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
  queueName: env.QUEUE_NAME
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

const sendViaGatewayApi = async (to: string, text: string): Promise<{ id?: string; raw?: unknown }> => {
  logger.info(
    withCategory("WA-OUT", {
      to,
      textPreview: text.slice(0, 80)
    }),
    "send reminder via placeholder sender"
  );
  return { id: `local-${Date.now()}`, raw: { to, text } };
};

void reportStartupStatus();

const worker = new Worker(
  env.QUEUE_NAME,
  async (job) => {
    if (job.name === "send-reminder") {
      const reminderId = String(job.data.reminderId ?? "");
      const reminder = await getReminderById(reminderId);
      if (!reminder) return;
      if (reminder.status !== ReminderStatus.SCHEDULED) {
        logger.info({ reminderId, status: reminder.status }, "reminder already processed");
        return;
      }

      try {
        const to = reminder.waGroupId ?? reminder.waUserId;
        if (!to) throw new Error("Reminder has no recipient");
        const sent = await sendViaGatewayApi(to, `⏰ Reminder: ${reminder.message}`);
        await updateReminderStatus(reminder.id, ReminderStatus.SENT);
        await markReminderMessage({ reminderId: reminder.id, messageId: sent.id });
        await persistOutboundMessage({
          tenantId: reminder.tenantId ?? "",
          userId: reminder.userId ?? undefined,
          groupId: reminder.groupId ?? undefined,
          waUserId: reminder.waUserId ?? to,
          waGroupId: reminder.waGroupId ?? undefined,
          text: `⏰ Reminder: ${reminder.message}`,
          waMessageId: sent.id,
          rawJson: sent.raw
        });
      } catch (error) {
        await updateReminderStatus(reminder.id, ReminderStatus.FAILED);
        logger.error({ reminderId, error }, "failed to process reminder");
        throw error;
      }
    } else if (job.name === "fire-timer") {
      const timerId = String(job.data.timerId ?? "");
      const timer = await getTimerById(timerId);
      if (!timer) return;
      if (timer.status !== TimerStatus.SCHEDULED) {
        logger.info({ timerId, status: timer.status }, "timer already processed");
        return;
      }

      try {
        const to = timer.waGroupId ?? timer.waUserId;
        if (!to) throw new Error("Timer has no recipient");
        const label = timer.label ? ` (${timer.label})` : "";
        const text = `⏱ Timer finalizado${label}`;
        const sent = await sendViaGatewayApi(to, text);
        await updateTimerStatus(timer.id, TimerStatus.FIRED);
        await markTimerMessage({ timerId: timer.id, messageId: sent.id });
        await persistOutboundMessage({
          tenantId: timer.tenantId ?? "",
          userId: timer.userId ?? undefined,
          groupId: timer.groupId ?? undefined,
          waUserId: timer.waUserId ?? to,
          waGroupId: timer.waGroupId ?? undefined,
          text,
          waMessageId: sent.id,
          rawJson: sent.raw
        });
      } catch (error) {
        await updateTimerStatus(timerId, TimerStatus.FAILED);
        logger.error({ timerId, error }, "failed to process timer");
        throw error;
      }
    }
  },
  { connection: connection as unknown as any }
);

worker.on("completed", (job) => logger.info(withCategory("QUEUE", { jobId: job.id }), "job completed"));
worker.on("failed", (job, error) => logger.error(withCategory("ERROR", { jobId: job?.id, error }), "job failed"));

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
