import Fastify from "fastify";
import { prisma, createRedisConnection, featureFlagRepository, triggerRepository, auditLogRepository } from "@zappy/adapters";
import { createLogger, featureFlagSchema, loadEnv, triggerSchema } from "@zappy/shared";

const env = loadEnv();
const logger = createLogger("assistant-api");
const redis = createRedisConnection(env.REDIS_URL);

const app = Fastify({ logger });

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
  if (token !== env.ADMIN_API_TOKEN) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
});

app.get("/admin/flags", async () => featureFlagRepository.list());
app.post("/admin/flags", async (request) => featureFlagRepository.create(featureFlagSchema.parse(request.body), "admin-api"));
app.put("/admin/flags/:id", async (request) => {
  const params = request.params as { id: string };
  return featureFlagRepository.update(params.id, featureFlagSchema.parse(request.body), "admin-api");
});
app.delete("/admin/flags/:id", async (request, reply) => {
  const params = request.params as { id: string };
  await featureFlagRepository.remove(params.id, "admin-api");
  reply.code(204).send();
});

app.get("/admin/triggers", async () => triggerRepository.list());
app.post("/admin/triggers", async (request) => triggerRepository.create(triggerSchema.parse(request.body), "admin-api"));
app.put("/admin/triggers/:id", async (request) => {
  const params = request.params as { id: string };
  return triggerRepository.update(params.id, triggerSchema.parse(request.body), "admin-api");
});
app.delete("/admin/triggers/:id", async (request, reply) => {
  const params = request.params as { id: string };
  await triggerRepository.remove(params.id, "admin-api");
  reply.code(204).send();
});

app.get("/admin/logs", async (request) => {
  const query = request.query as { limit?: string };
  const limit = Number.parseInt(query.limit ?? "100", 10);
  return auditLogRepository.list(Number.isNaN(limit) ? 100 : limit);
});

const start = async () => {
  try {
    await app.listen({ port: env.ADMIN_API_PORT, host: "0.0.0.0" });
    logger.info({ port: env.ADMIN_API_PORT }, "assistant-api started");
  } catch (error) {
    logger.error(error, "assistant-api failed");
    process.exit(1);
  }
};

const shutdown = async () => {
  logger.info("shutting down assistant-api");
  await app.close();
  await redis.quit();
  await prisma.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

void start();
