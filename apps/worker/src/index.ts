import { Worker } from "bullmq";
import { createRedisConnection } from "@zappy/adapters";
import { createLogger, loadEnv } from "@zappy/shared";

const env = loadEnv();
const logger = createLogger("worker");
const connection = createRedisConnection(env.REDIS_URL);

const worker = new Worker(
  env.QUEUE_NAME,
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, "processing placeholder job");
  },
  { connection }
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "job completed");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error }, "job failed");
});

const shutdown = async () => {
  logger.info("shutting down worker");
  await worker.close();
  await connection.quit();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

logger.info({ queue: env.QUEUE_NAME }, "worker started");
