import Fastify from "fastify";
import { prisma } from "@zappy/adapters";
import { printStartupBanner, withCategory } from "@zappy/shared";
import { createAdminApiRuntime } from "./bootstrap/runtime.js";
import { reportStartupStatus } from "./bootstrap/startup-status.js";
import { registerAdminApiRoutes } from "./http/routes.js";

const runtime = createAdminApiRuntime();
const app = Fastify({ loggerInstance: runtime.logger });

printStartupBanner(runtime.logger, {
  app: "Admin API",
  environment: runtime.env.NODE_ENV,
  timezone: runtime.env.BOT_TIMEZONE,
  llmEnabled: runtime.env.LLM_ENABLED,
  model: runtime.env.LLM_MODEL,
  adminApiUrl: `http://localhost:${runtime.env.ADMIN_API_PORT}`,
  adminUiUrl: `http://localhost:${runtime.env.ADMIN_UI_PORT}`,
  queueName: runtime.env.QUEUE_NAME,
  redisStatus: "PENDING",
  dbStatus: "PENDING",
  llmStatus: runtime.env.LLM_ENABLED ? "PENDING" : undefined,
  workerStatus: "PENDING"
});

registerAdminApiRoutes(app as any, runtime);

const start = async () => {
  try {
    await reportStartupStatus(runtime);
    await app.listen({ port: runtime.env.ADMIN_API_PORT, host: "0.0.0.0" });
    runtime.logger.info(withCategory("HTTP", { port: runtime.env.ADMIN_API_PORT }), "admin-api started");
  } catch (error) {
    runtime.logger.error(withCategory("ERROR", { err: error }), "admin-api failed");
    process.exit(1);
  }
};

const shutdown = async () => {
  await app.close();
  await runtime.queue.close();
  await runtime.redis.quit();
  await prisma.$disconnect();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

void start();
