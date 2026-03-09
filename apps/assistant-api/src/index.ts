import Fastify from "fastify";
import {
  auditLogRepository,
  createQueue,
  createRedisConnection,
  featureFlagRepository,
  getGatewayHeartbeat,
  getWorkerHeartbeat,
  getRecentMessages,
  prisma,
  triggerRepository
} from "@zappy/adapters";
import { createLogger, featureFlagSchema, loadEnv, printStartupBanner, triggerSchema, withCategory } from "@zappy/shared";

const env = loadEnv();
const logger = createLogger("assistant-api");
const redis = createRedisConnection(env.REDIS_URL);
const queue = createQueue(env.QUEUE_NAME, env.REDIS_URL);
const app = Fastify({ loggerInstance: logger });

printStartupBanner(logger, {
  app: "Assistant API",
  environment: env.NODE_ENV,
  timezone: env.BOT_TIMEZONE,
  llmEnabled: env.LLM_ENABLED,
  model: env.LLM_MODEL,
  adminApiUrl: `http://localhost:${env.ADMIN_API_PORT}`,
  adminUiUrl: `http://localhost:${env.ADMIN_UI_PORT}`,
  queueName: env.QUEUE_NAME,
  redisStatus: "PENDING",
  dbStatus: "PENDING",
  llmStatus: env.LLM_ENABLED ? "PENDING" : undefined,
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
  logger.info(withCategory("DB", { status: dbOk ? "OK" : "FAIL" }), `DB ${dbOk ? "OK" : "FAIL"}`);
  logger.info(withCategory("SYSTEM", { target: "Redis", status: redisOk ? "OK" : "FAIL" }), `Redis ${redisOk ? "OK" : "FAIL"}`);
};

app.get("/health", async () => {
  let db = "ok";
  let redisStatus = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }
  try {
    await redis.ping();
  } catch {
    redisStatus = "error";
  }
  return { ok: db === "ok" && redisStatus === "ok", db, redis: redisStatus };
});

app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/admin")) return;
  const token = request.headers.authorization?.replace("Bearer ", "");
  if (token !== env.ADMIN_API_TOKEN) return reply.status(401).send({ error: "Unauthorized" });
});

app.get("/admin/flags", async () => featureFlagRepository.list());
app.post("/admin/flags", async (request) => featureFlagRepository.create(featureFlagSchema.parse(request.body), "admin-api"));
app.put("/admin/flags/:id", async (request) => featureFlagRepository.update((request.params as { id: string }).id, featureFlagSchema.parse(request.body), "admin-api"));
app.delete("/admin/flags/:id", async (request, reply) => {
  await featureFlagRepository.remove((request.params as { id: string }).id, "admin-api");
  reply.code(204).send();
});

app.get("/admin/triggers", async () => triggerRepository.list());
app.post("/admin/triggers", async (request) => triggerRepository.create(triggerSchema.parse(request.body), "admin-api"));
app.put("/admin/triggers/:id", async (request) => triggerRepository.update((request.params as { id: string }).id, triggerSchema.parse(request.body), "admin-api"));
app.delete("/admin/triggers/:id", async (request, reply) => {
  await triggerRepository.remove((request.params as { id: string }).id, "admin-api");
  reply.code(204).send();
});

app.get("/admin/logs", async (request) => {
  const limit = Number.parseInt((request.query as { limit?: string }).limit ?? "100", 10);
  return auditLogRepository.list(Number.isNaN(limit) ? 100 : limit);
});

app.get("/admin/messages", async (request) => {
  const limit = Number.parseInt((request.query as { limit?: string }).limit ?? "50", 10);
  return getRecentMessages(Number.isNaN(limit) ? 50 : limit);
});

app.get("/admin/status", async () => {
  const heartbeat = await getGatewayHeartbeat(redis);
  const worker = await getWorkerHeartbeat(redis);
  const [waiting, active, failed, delayed] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount(), queue.getFailedCount(), queue.getDelayedCount()]);
  return { gateway: heartbeat, worker, queue: { waiting, active, failed, delayed } };
});

const start = async () => {
  try {
    await reportStartupStatus();
    await app.listen({ port: env.ADMIN_API_PORT, host: "0.0.0.0" });
    logger.info(withCategory("HTTP", { port: env.ADMIN_API_PORT }), "assistant-api started");
  } catch (error) {
    logger.error(withCategory("ERROR", { err: error }), "assistant-api failed");
    process.exit(1);
  }
};

const shutdown = async () => {
  await app.close();
  await queue.close();
  await redis.quit();
  await prisma.$disconnect();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

void start();
