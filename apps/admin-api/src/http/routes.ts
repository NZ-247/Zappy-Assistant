import {
  adminGovernanceRepository as fallbackAdminGovernanceRepository,
  adminJobsRepository as fallbackAdminJobsRepository,
  auditLogRepository,
  commandLogRepository,
  featureFlagRepository,
  getGatewayHeartbeat,
  getRecentMessages,
  getWorkerHeartbeat,
  governancePort as fallbackGovernancePort,
  triggerRepository
} from "@zappy/adapters";
import { resolveGovernanceDecision, type DecisionInput, type GovernanceRequiredRole } from "@zappy/core";
import { featureFlagSchema, triggerSchema } from "@zappy/shared";
import { z } from "zod";
import { checkDatabaseHealth, checkRedisHealth } from "../bootstrap/startup-status.js";
import type { AdminApiRuntime } from "../bootstrap/runtime.js";
import { registerAdminAuthHook } from "./auth-hook.js";

interface AdminApiHttpApp {
  addHook: (name: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
  get: (route: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
  post: (route: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
  put: (route: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
  patch: (route: string, handler: (...args: any[]) => Promise<unknown> | unknown) => unknown;
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

const ADMIN_API_VERSION = "1.7.0";
const GOVERNANCE_VERSION = "v1.7.0";
const HEALTH_CHECK_TIMEOUT_MS = 3_500;
const reminderStatuses = ["SCHEDULED", "SENT", "FAILED", "CANCELED"] as const;

const accessUpdateBodySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "BLOCKED"]),
  actor: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional()
});

const licenseUpdateBodySchema = z.object({
  tier: z.enum(["FREE", "BASIC", "PRO", "ROOT"]),
  actor: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional()
});

const reminderQuerySchema = z.object({
  tenantId: z.string().min(1).optional(),
  status: z.enum(reminderStatuses).optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

const reminderRetryBodySchema = z.object({
  actor: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional()
});

const usageQuerySchema = z.object({
  tenantId: z.string().min(1).optional()
});

const tenantListQuerySchema = z.object({
  tenantId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  subjectType: z.enum(["USER", "GROUP"]).optional(),
  subjectId: z.string().min(1).optional()
});

type ExternalServiceHealth = {
  configured: boolean;
  online: boolean;
  ok: boolean;
  status: "ok" | "unavailable" | "error" | "not_configured";
  checkedAt: string;
  latencyMs: number | null;
  httpStatus: number | null;
  baseUrl?: string;
  error?: string;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
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

const parseLimit = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 500);
};

const checkExternalServiceHealth = async (input: {
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<ExternalServiceHealth> => {
  const checkedAt = new Date().toISOString();
  const baseUrl = input.baseUrl?.trim();
  if (!baseUrl) {
    return {
      configured: false,
      online: false,
      ok: false,
      status: "not_configured",
      checkedAt,
      latencyMs: null,
      httpStatus: null
    };
  }

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      method: "GET",
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;
    clearTimeout(timeout);

    return {
      configured: true,
      online: response.ok,
      ok: response.ok,
      status: response.ok ? "ok" : "unavailable",
      checkedAt,
      latencyMs,
      httpStatus: response.status,
      baseUrl
    };
  } catch (error) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - startedAt;
    return {
      configured: true,
      online: false,
      ok: false,
      status: "error",
      checkedAt,
      latencyMs,
      httpStatus: null,
      baseUrl,
      error: toErrorMessage(error)
    };
  }
};

export const registerAdminApiRoutes = (app: AdminApiHttpApp, runtime: AdminApiRuntime): void => {
  registerAdminAuthHook(app, runtime.env.ADMIN_API_TOKEN);

  app.get("/health", async () => {
    const dbOk = await checkDatabaseHealth();
    const redisOk = await checkRedisHealth(runtime);
    return {
      ok: dbOk && redisOk,
      service: "admin-api",
      version: ADMIN_API_VERSION,
      db: dbOk ? "ok" : "error",
      redis: redisOk ? "ok" : "error",
      now: new Date().toISOString()
    };
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
    const limit = parseLimit((request.query as { limit?: string }).limit, 100);
    return auditLogRepository.list(limit);
  });

  app.get("/admin/messages", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50);
    return getRecentMessages(limit);
  });

  app.get("/admin/commands", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50);
    return commandLogRepository.list(limit);
  });

  app.get("/admin/queues", async () => {
    const counts = await runtime.queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
    const worker = await getWorkerHeartbeat(runtime.redis);
    return { queues: [{ name: runtime.queue.name, counts }], worker };
  });

  app.get("/admin/metrics/summary", async () => runtime.metrics.getSnapshot());

  const statusHandler = async () => {
    const jobsRepository = runtime.adminJobsRepository ?? fallbackAdminJobsRepository;
    const assistantApiBaseUrl = process.env.ASSISTANT_API_BASE_URL;

    const [gateway, worker, dbOk, redisOk, jobCounts, reminderCounts, recentFailedReminders, mediaResolverHealth, assistantApiHealth] =
      await Promise.all([
        getGatewayHeartbeat(runtime.redis),
        getWorkerHeartbeat(runtime.redis),
        checkDatabaseHealth(),
        checkRedisHealth(runtime),
        runtime.queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        jobsRepository.getReminderStatusCounts(),
        jobsRepository.listRecentFailedReminders({ limit: 5 }),
        checkExternalServiceHealth({ baseUrl: runtime.env.MEDIA_RESOLVER_API_BASE_URL }),
        checkExternalServiceHealth({ baseUrl: assistantApiBaseUrl })
      ]);

    const llmConfigured = Boolean(runtime.env.OPENAI_API_KEY);
    const now = new Date().toISOString();

    const warnings: string[] = [];
    if (!gateway.online) warnings.push("wa-gateway heartbeat is stale or unavailable");
    if (!worker.online) warnings.push("worker heartbeat is stale or unavailable");
    if (!dbOk) warnings.push("postgres health check failed");
    if (!redisOk) warnings.push("redis health check failed");
    if (mediaResolverHealth.configured && !mediaResolverHealth.ok) warnings.push("media-resolver-api is unavailable");
    if (assistantApiHealth.configured && !assistantApiHealth.ok) warnings.push("assistant-api is unavailable");

    return {
      schemaVersion: "admin.status.v2",
      service: "admin-api",
      version: ADMIN_API_VERSION,
      projectVersion: ADMIN_API_VERSION,
      checkedAt: now,
      services: {
        gateway: {
          online: gateway.online,
          connected: gateway.isConnected,
          lastHeartbeat: gateway.at,
          ageSeconds: gateway.ageSeconds
        },
        worker: {
          online: worker.online,
          lastHeartbeat: worker.at,
          ageSeconds: worker.ageSeconds
        },
        adminApi: {
          online: true,
          ok: dbOk && redisOk,
          lastHeartbeat: now,
          ageSeconds: 0
        },
        mediaResolverApi: mediaResolverHealth,
        assistantApi: assistantApiHealth
      },
      db: { ok: dbOk },
      redis: { ok: redisOk },
      llm: {
        enabled: runtime.env.LLM_ENABLED,
        configured: llmConfigured,
        ok: runtime.env.LLM_ENABLED ? llmConfigured : false
      },
      bot: { connected: gateway.isConnected, lastHeartbeat: gateway.at },
      queue: { name: runtime.queue.name, ...jobCounts },
      reminders: {
        ...reminderCounts,
        total: reminderCounts.SCHEDULED + reminderCounts.SENT + reminderCounts.FAILED + reminderCounts.CANCELED
      },
      resolver: {
        health: mediaResolverHealth,
        configuredProviders: {
          yt: runtime.env.DOWNLOADS_PROVIDER_YT_ENABLED,
          ig: runtime.env.DOWNLOADS_PROVIDER_IG_ENABLED,
          fb: runtime.env.DOWNLOADS_PROVIDER_FB_ENABLED,
          direct: runtime.env.DOWNLOADS_PROVIDER_DIRECT_ENABLED
        }
      },
      failures: {
        queueFailedJobs: jobCounts.failed ?? 0,
        failedReminders: reminderCounts.FAILED,
        recentFailedReminders
      },
      warnings
    };
  };

  app.get("/admin/status", statusHandler);
  app.get("/admin/v1/status", statusHandler);

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
      governanceVersion: GOVERNANCE_VERSION,
      shadowMode: true,
      input,
      decision
    };
  });

  app.get("/admin/v1/users", async (request) => {
    const query = tenantListQuerySchema.parse(request.query ?? {});
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const items = await repository.listUsers({ tenantId: query.tenantId, limit: query.limit });
    return {
      schemaVersion: "admin.users.v1",
      count: items.length,
      items
    };
  });

  app.get("/admin/v1/users/:waUserId", async (request) => {
    const query = usageQuerySchema.parse(request.query ?? {});
    const params = request.params as { waUserId: string };
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const item = await repository.getUser({ tenantId: query.tenantId, waUserId: params.waUserId });
    return {
      schemaVersion: "admin.user.v1",
      item
    };
  });

  app.patch("/admin/v1/users/:waUserId/access", async (request) => {
    const params = request.params as { waUserId: string };
    const body = accessUpdateBodySchema.parse(request.body);
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const item = await repository.updateUserAccessStatus({
      tenantId: body.tenantId,
      waUserId: params.waUserId,
      status: body.status,
      actor: body.actor ?? "admin-api"
    });
    return {
      schemaVersion: "admin.user.access.v1",
      item
    };
  });

  app.get("/admin/v1/groups", async (request) => {
    const query = tenantListQuerySchema.parse(request.query ?? {});
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const items = await repository.listGroups({ tenantId: query.tenantId, limit: query.limit });
    return {
      schemaVersion: "admin.groups.v1",
      count: items.length,
      items
    };
  });

  app.get("/admin/v1/groups/:waGroupId", async (request) => {
    const query = usageQuerySchema.parse(request.query ?? {});
    const params = request.params as { waGroupId: string };
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const item = await repository.getGroup({ tenantId: query.tenantId, waGroupId: params.waGroupId });
    return {
      schemaVersion: "admin.group.v1",
      item
    };
  });

  app.patch("/admin/v1/groups/:waGroupId/access", async (request) => {
    const params = request.params as { waGroupId: string };
    const body = accessUpdateBodySchema.parse(request.body);
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const item = await repository.updateGroupAccessStatus({
      tenantId: body.tenantId,
      waGroupId: params.waGroupId,
      status: body.status,
      actor: body.actor ?? "admin-api"
    });
    return {
      schemaVersion: "admin.group.access.v1",
      item
    };
  });

  app.get("/admin/v1/licenses/plans", async () => {
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const plans = await repository.listLicensePlans();
    return {
      schemaVersion: "admin.license.plans.v1",
      count: plans.length,
      plans
    };
  });

  app.patch("/admin/v1/users/:waUserId/license", async (request) => {
    const params = request.params as { waUserId: string };
    const body = licenseUpdateBodySchema.parse(request.body);
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const item = await repository.updateUserLicense({
      tenantId: body.tenantId,
      waUserId: params.waUserId,
      tier: body.tier,
      actor: body.actor ?? "admin-api"
    });
    return {
      schemaVersion: "admin.user.license.v1",
      item
    };
  });

  app.patch("/admin/v1/groups/:waGroupId/license", async (request) => {
    const params = request.params as { waGroupId: string };
    const body = licenseUpdateBodySchema.parse(request.body);
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const item = await repository.updateGroupLicense({
      tenantId: body.tenantId,
      waGroupId: params.waGroupId,
      tier: body.tier,
      actor: body.actor ?? "admin-api"
    });
    return {
      schemaVersion: "admin.group.license.v1",
      item
    };
  });

  app.get("/admin/v1/usage/users/:waUserId", async (request) => {
    const params = request.params as { waUserId: string };
    const query = usageQuerySchema.parse(request.query ?? {});
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const usage = await repository.getUserUsage({ tenantId: query.tenantId, waUserId: params.waUserId });
    return {
      schemaVersion: "admin.usage.user.v1",
      ...usage
    };
  });

  app.get("/admin/v1/usage/groups/:waGroupId", async (request) => {
    const params = request.params as { waGroupId: string };
    const query = usageQuerySchema.parse(request.query ?? {});
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const usage = await repository.getGroupUsage({ tenantId: query.tenantId, waGroupId: params.waGroupId });
    return {
      schemaVersion: "admin.usage.group.v1",
      ...usage
    };
  });

  app.get("/admin/v1/audit", async (request) => {
    const query = auditQuerySchema.parse(request.query ?? {});
    const repository = runtime.adminGovernanceRepository ?? fallbackAdminGovernanceRepository;
    const items = await repository.listApprovalAudit({
      limit: query.limit,
      subjectType: query.subjectType,
      subjectId: query.subjectId
    });
    return {
      schemaVersion: "admin.audit.v1",
      count: items.length,
      items
    };
  });

  app.get("/admin/v1/reminders", async (request) => {
    const query = reminderQuerySchema.parse(request.query ?? {});
    const repository = runtime.adminJobsRepository ?? fallbackAdminJobsRepository;
    const items = await repository.listReminders({
      tenantId: query.tenantId,
      status: query.status,
      limit: query.limit
    });

    return {
      schemaVersion: "admin.reminders.v1",
      count: items.length,
      items
    };
  });

  app.post("/admin/v1/reminders/:reminderId/retry", async (request, reply) => {
    const params = request.params as { reminderId: string };
    const body = reminderRetryBodySchema.parse(request.body ?? {});
    const repository = runtime.adminJobsRepository ?? fallbackAdminJobsRepository;

    const current = await repository.getReminder({
      reminderId: params.reminderId,
      tenantId: body.tenantId
    });

    if (!current) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Reminder not found"
        }
      });
    }

    if (current.status !== "FAILED") {
      return reply.code(409).send({
        error: {
          code: "INVALID_STATE",
          message: `Reminder retry is only allowed for FAILED status (current: ${current.status})`
        }
      });
    }

    const scheduled = await repository.markReminderForRetry({
      reminderId: current.id,
      tenantId: body.tenantId
    });

    if (!scheduled) {
      return reply.code(500).send({
        error: {
          code: "RETRY_PREPARE_FAILED",
          message: "Could not prepare reminder retry"
        }
      });
    }

    const nowMs = Date.now();
    const delayMs = Math.max(0, scheduled.remindAt.getTime() - nowMs);
    const runAt = new Date(nowMs + delayMs);

    try {
      await runtime.queue.remove(scheduled.id).catch(() => undefined);
      const job = await runtime.queue.add("send-reminder", { reminderId: scheduled.id }, { jobId: scheduled.id, delay: delayMs });

      return {
        schemaVersion: "admin.reminder.retry.v1",
        actor: body.actor ?? "admin-api",
        item: scheduled,
        queue: {
          name: runtime.queue.name,
          jobId: String(job.id),
          delayMs,
          runAt: runAt.toISOString()
        }
      };
    } catch (error) {
      await repository.setReminderStatus({ reminderId: scheduled.id, status: "FAILED", tenantId: body.tenantId }).catch(() => undefined);
      return reply.code(500).send({
        error: {
          code: "RETRY_QUEUE_FAILED",
          message: toErrorMessage(error)
        }
      });
    }
  });
};
