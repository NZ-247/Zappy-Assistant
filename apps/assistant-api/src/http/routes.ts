import {
  auditLogRepository,
  commandLogRepository,
  featureFlagRepository,
  getGatewayHeartbeat,
  getRecentMessages,
  getWorkerHeartbeat,
  triggerRepository
} from "@zappy/adapters";
import { featureFlagSchema, triggerSchema } from "@zappy/shared";
import { checkDatabaseHealth, checkRedisHealth } from "../bootstrap/startup-status.js";
import { registerAdminAuthHook } from "./auth-hook.js";
import type { AssistantApiRuntime } from "../bootstrap/runtime.js";

interface AssistantApiHttpApp {
  addHook: (name: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
  get: (route: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
  post: (route: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
  put: (route: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
  delete: (route: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
}

export const registerAssistantApiRoutes = (app: AssistantApiHttpApp, runtime: AssistantApiRuntime): void => {
  registerAdminAuthHook(app, runtime.env.ADMIN_API_TOKEN);

  app.get("/health", async () => {
    const dbOk = await checkDatabaseHealth();
    const redisOk = await checkRedisHealth(runtime);
    return { ok: dbOk && redisOk, db: dbOk ? "ok" : "error", redis: redisOk ? "ok" : "error" };
  });

  app.get("/admin/flags", async () => featureFlagRepository.list());
  app.post("/admin/flags", async (request) => featureFlagRepository.create(featureFlagSchema.parse(request.body), "admin-api"));
  app.put("/admin/flags/:id", async (request) =>
    featureFlagRepository.update((request.params as { id: string }).id, featureFlagSchema.parse(request.body), "admin-api")
  );
  app.delete("/admin/flags/:id", async (request, reply) => {
    await featureFlagRepository.remove((request.params as { id: string }).id, "admin-api");
    reply.code(204).send();
  });

  app.get("/admin/triggers", async () => triggerRepository.list());
  app.post("/admin/triggers", async (request) => triggerRepository.create(triggerSchema.parse(request.body), "admin-api"));
  app.put("/admin/triggers/:id", async (request) =>
    triggerRepository.update((request.params as { id: string }).id, triggerSchema.parse(request.body), "admin-api")
  );
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

  app.get("/admin/commands", async (request) => {
    const limit = Number.parseInt((request.query as { limit?: string }).limit ?? "50", 10);
    return commandLogRepository.list(Number.isNaN(limit) ? 50 : limit);
  });

  app.get("/admin/queues", async () => {
    const counts = await runtime.queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
    const worker = await getWorkerHeartbeat(runtime.redis);
    return { queues: [{ name: runtime.queue.name, counts }], worker };
  });

  app.get("/admin/metrics/summary", async () => runtime.metrics.getSnapshot());

  app.get("/admin/status", async () => {
    const [gateway, worker, dbOk, redisOk, jobCounts] = await Promise.all([
      getGatewayHeartbeat(runtime.redis),
      getWorkerHeartbeat(runtime.redis),
      checkDatabaseHealth(),
      checkRedisHealth(runtime),
      runtime.queue.getJobCounts("waiting", "active", "completed", "failed", "delayed")
    ]);
    const llmConfigured = Boolean(runtime.env.OPENAI_API_KEY);
    return {
      services: {
        gateway: { online: gateway.online, connected: gateway.isConnected, lastHeartbeat: gateway.at, ageSeconds: gateway.ageSeconds },
        worker: { online: worker.online, lastHeartbeat: worker.at, ageSeconds: worker.ageSeconds }
      },
      db: { ok: dbOk },
      redis: { ok: redisOk },
      llm: { enabled: runtime.env.LLM_ENABLED, configured: llmConfigured, ok: runtime.env.LLM_ENABLED ? llmConfigured : false },
      bot: { connected: gateway.isConnected, lastHeartbeat: gateway.at },
      queue: { name: runtime.queue.name, ...jobCounts }
    };
  });
};
