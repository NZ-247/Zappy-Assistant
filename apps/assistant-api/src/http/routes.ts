import {
  auditLogRepository,
  commandLogRepository,
  featureFlagRepository,
  getGatewayHeartbeat,
  governancePort as fallbackGovernancePort,
  getRecentMessages,
  getWorkerHeartbeat,
  triggerRepository
} from "@zappy/adapters";
import { resolveGovernanceDecision, type DecisionInput, type GovernanceRequiredRole } from "@zappy/core";
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

type GovernanceSnapshotQuery = {
  tenantId?: string;
  waUserId?: string;
  waGroupId?: string;
  scope?: string;
  capability?: string;
  routeKey?: string;
  route?: string;
  commandName?: string;
  requiredRole?: GovernanceRequiredRole;
  requiresBotAdmin?: string;
  requiresGroupAdmin?: string;
  senderIsGroupAdmin?: string;
  botIsGroupAdmin?: string;
  botAdminCheckFailed?: string;
  botAdminStatusSource?: string;
  permissionRole?: string;
  relationshipProfile?: string;
  consentStatus?: "PENDING" | "ACCEPTED" | "DECLINED" | "UNKNOWN";
  consentRequired?: string;
  consentBypass?: string;
  termsVersion?: string;
  messageKind?: string;
  rawMessageType?: string;
  ingressSource?: string;
  isBotMentioned?: string;
  isReplyToBot?: string;
};

const parseBoolean = (value?: string): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const parseScope = (query: GovernanceSnapshotQuery): "private" | "group" => {
  if (query.scope === "group") return "group";
  if (query.scope === "private") return "private";
  return query.waGroupId ? "group" : "private";
};

const buildGovernanceDecisionInput = (query: GovernanceSnapshotQuery): DecisionInput | null => {
  if (!query.tenantId || !query.waUserId) return null;
  const scope = parseScope(query);
  const isGroup = scope === "group";
  const requiredRole = query.requiredRole as GovernanceRequiredRole | undefined;
  const relationshipProfile = query.relationshipProfile as DecisionInput["user"]["relationshipProfile"];

  return {
    tenant: {
      id: query.tenantId
    },
    user: {
      waUserId: query.waUserId,
      permissionRole: query.permissionRole,
      relationshipProfile,
      senderIsGroupAdmin: parseBoolean(query.senderIsGroupAdmin) ?? null
    },
    group: query.waGroupId
      ? {
          waGroupId: query.waGroupId
        }
      : undefined,
    context: {
      scope,
      isGroup,
      routeKey: query.routeKey ?? "admin.snapshot"
    },
    consent: {
      status: query.consentStatus,
      termsVersion: query.termsVersion,
      required: parseBoolean(query.consentRequired),
      bypass: parseBoolean(query.consentBypass)
    },
    request: {
      capability: (query.capability ?? (isGroup ? "conversation.group" : "conversation.direct")).trim().toLowerCase(),
      commandName: query.commandName,
      requiredRole,
      requiresBotAdmin: parseBoolean(query.requiresBotAdmin),
      requiresGroupAdmin: parseBoolean(query.requiresGroupAdmin),
      route: query.route
    },
    message: {
      kind: query.messageKind,
      rawMessageType: query.rawMessageType,
      ingressSource: query.ingressSource,
      isBotMentioned: parseBoolean(query.isBotMentioned),
      isReplyToBot: parseBoolean(query.isReplyToBot)
    },
    runtimePolicySignals: {
      botIsGroupAdmin: parseBoolean(query.botIsGroupAdmin),
      botAdminCheckFailed: parseBoolean(query.botAdminCheckFailed),
      botAdminStatusSource: query.botAdminStatusSource
    }
  };
};

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

  app.get("/admin/v1/governance/snapshot", async (request, reply) => {
    const query = request.query as GovernanceSnapshotQuery;
    const input = buildGovernanceDecisionInput(query);

    if (!input) {
      return reply.code(400).send({
        error: "Missing required query params: tenantId, waUserId"
      });
    }

    const governance = runtime.governancePort ?? fallbackGovernancePort;
    const decision = await resolveGovernanceDecision(governance, input);

    return {
      schemaVersion: "governance.snapshot.v1",
      governanceVersion: "v1.6.3",
      shadowMode: true,
      input,
      decision
    };
  });

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
