import { Worker } from "bullmq";
import {
  createRedisConnection,
  getReminderById,
  markReminderMessage,
  persistOutboundMessage,
  prisma,
  updateReminderStatus
} from "@zappy/adapters";
import { ReminderStatus } from "@prisma/client";
import { createLogger, loadEnv } from "@zappy/shared";

const env = loadEnv();
const logger = createLogger("worker");
const connection = createRedisConnection(env.REDIS_URL);

const sendViaGatewayApi = async (to: string, text: string): Promise<{ id?: string; raw?: unknown }> => {
  logger.info({ to, text }, "send reminder via placeholder sender");
  return { id: `local-${Date.now()}`, raw: { to, text } };
};

const worker = new Worker(
  env.QUEUE_NAME,
  async (job) => {
    if (job.name !== "send-reminder") return;
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
  },
  { connection }
);

worker.on("completed", (job) => logger.info({ jobId: job.id }, "job completed"));
worker.on("failed", (job, error) => logger.error({ jobId: job?.id, error }, "job failed"));

const shutdown = async () => {
  logger.info("shutting down worker");
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

logger.info({ queue: env.QUEUE_NAME }, "worker started");
