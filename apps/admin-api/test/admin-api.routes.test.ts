import { strict as assert } from "node:assert";
import test from "node:test";
import Fastify from "fastify";
import { registerAdminApiRoutes } from "../src/http/routes.js";

const buildRuntime = () => {
  const users = new Map<string, any>();
  const groups = new Map<string, any>();
  const audit: any[] = [];
  const reminders = new Map<string, any>();

  const nowIso = () => new Date("2026-04-14T12:00:00.000Z").toISOString();

  reminders.set("r-failed-1", {
    id: "r-failed-1",
    tenantId: "tenant-1",
    waUserId: "u-123",
    waGroupId: null,
    publicId: "RMD001",
    sequence: 1,
    message: "Failed reminder",
    remindAt: new Date("2026-04-14T11:00:00.000Z"),
    status: "FAILED",
    sentMessageId: null,
    createdAt: new Date("2026-04-14T10:00:00.000Z"),
    updatedAt: new Date("2026-04-14T11:10:00.000Z")
  });
  reminders.set("r-scheduled-1", {
    id: "r-scheduled-1",
    tenantId: "tenant-1",
    waUserId: "u-456",
    waGroupId: null,
    publicId: "RMD002",
    sequence: 2,
    message: "Scheduled reminder",
    remindAt: new Date("2026-04-14T15:00:00.000Z"),
    status: "SCHEDULED",
    sentMessageId: null,
    createdAt: new Date("2026-04-14T10:00:00.000Z"),
    updatedAt: new Date("2026-04-14T10:30:00.000Z")
  });

  const ensureUser = (waUserId: string) => {
    const existing = users.get(waUserId);
    if (existing) return existing;
    const created = {
      tenantId: "tenant-1",
      waUserId,
      displayName: waUserId,
      phoneNumber: null,
      status: "PENDING",
      tier: "FREE",
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
      updatedAt: new Date("2026-04-14T00:00:00.000Z")
    };
    users.set(waUserId, created);
    return created;
  };

  const ensureGroup = (waGroupId: string) => {
    const existing = groups.get(waGroupId);
    if (existing) return existing;
    const created = {
      tenantId: "tenant-1",
      waGroupId,
      groupName: waGroupId,
      status: "PENDING",
      tier: "FREE",
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
      updatedAt: new Date("2026-04-14T00:00:00.000Z")
    };
    groups.set(waGroupId, created);
    return created;
  };

  const repository = {
    listUsers: async () => Array.from(users.values()),
    getUser: async ({ waUserId }: { waUserId: string }) => ensureUser(waUserId),
    updateUserAccessStatus: async ({ waUserId, status, actor }: { waUserId: string; status: string; actor: string }) => {
      const current = ensureUser(waUserId);
      const next = {
        ...current,
        status,
        approvedBy: status === "APPROVED" ? actor : null,
        approvedAt: status === "APPROVED" ? new Date(nowIso()) : null,
        updatedAt: new Date(nowIso())
      };
      users.set(waUserId, next);
      audit.unshift({
        subjectType: "USER",
        subjectId: waUserId,
        action: "USER_ACCESS_STATUS_UPDATED",
        actor,
        createdAt: new Date(nowIso())
      });
      return next;
    },
    listGroups: async () => Array.from(groups.values()),
    getGroup: async ({ waGroupId }: { waGroupId: string }) => ensureGroup(waGroupId),
    updateGroupAccessStatus: async ({ waGroupId, status, actor }: { waGroupId: string; status: string; actor: string }) => {
      const current = ensureGroup(waGroupId);
      const next = {
        ...current,
        status,
        approvedBy: status === "APPROVED" ? actor : null,
        approvedAt: status === "APPROVED" ? new Date(nowIso()) : null,
        updatedAt: new Date(nowIso())
      };
      groups.set(waGroupId, next);
      audit.unshift({
        subjectType: "GROUP",
        subjectId: waGroupId,
        action: "GROUP_ACCESS_STATUS_UPDATED",
        actor,
        createdAt: new Date(nowIso())
      });
      return next;
    },
    listLicensePlans: async () => [
      { tier: "FREE", displayName: "Free", active: true },
      { tier: "BASIC", displayName: "Basic", active: true },
      { tier: "PRO", displayName: "Pro", active: true },
      { tier: "ROOT", displayName: "Root", active: true }
    ],
    updateUserLicense: async ({ waUserId, tier, actor }: { waUserId: string; tier: string; actor: string }) => {
      const current = ensureUser(waUserId);
      const next = {
        ...current,
        tier,
        updatedAt: new Date(nowIso())
      };
      users.set(waUserId, next);
      audit.unshift({
        subjectType: "USER",
        subjectId: waUserId,
        action: "USER_LICENSE_UPDATED",
        actor,
        createdAt: new Date(nowIso())
      });
      return next;
    },
    updateGroupLicense: async ({ waGroupId, tier, actor }: { waGroupId: string; tier: string; actor: string }) => {
      const current = ensureGroup(waGroupId);
      const next = {
        ...current,
        tier,
        updatedAt: new Date(nowIso())
      };
      groups.set(waGroupId, next);
      audit.unshift({
        subjectType: "GROUP",
        subjectId: waGroupId,
        action: "GROUP_LICENSE_UPDATED",
        actor,
        createdAt: new Date(nowIso())
      });
      return next;
    },
    getUserUsage: async ({ waUserId }: { waUserId: string }) => ({
      subjectType: "USER",
      subjectId: waUserId,
      tenantId: "tenant-1",
      counters: [],
      summary: {
        inboundMessages: 3,
        outboundMessages: 2,
        commandsExecuted: 4
      }
    }),
    getGroupUsage: async ({ waGroupId }: { waGroupId: string }) => ({
      subjectType: "GROUP",
      subjectId: waGroupId,
      tenantId: "tenant-1",
      counters: [],
      summary: {
        inboundMessages: 8,
        outboundMessages: 7,
        commandsExecuted: 5
      }
    }),
    listApprovalAudit: async () => audit
  };

  const jobsRepository = {
    listReminders: async ({ tenantId, status, limit }: { tenantId?: string; status?: string; limit?: number } = {}) =>
      Array.from(reminders.values())
        .filter((item) => (!tenantId || item.tenantId === tenantId) && (!status || item.status === status))
        .slice(0, limit ?? 100),
    getReminder: async ({ reminderId, tenantId }: { reminderId: string; tenantId?: string }) => {
      const item = reminders.get(reminderId);
      if (!item) return null;
      if (tenantId && item.tenantId !== tenantId) return null;
      return item;
    },
    markReminderForRetry: async ({ reminderId }: { reminderId: string }) => {
      const current = reminders.get(reminderId);
      if (!current) return null;
      const next = { ...current, status: "SCHEDULED", updatedAt: new Date(nowIso()) };
      reminders.set(reminderId, next);
      return next;
    },
    setReminderStatus: async ({ reminderId, status }: { reminderId: string; status: string }) => {
      const current = reminders.get(reminderId);
      if (!current) return null;
      const next = { ...current, status, updatedAt: new Date(nowIso()) };
      reminders.set(reminderId, next);
      return next;
    },
    getReminderStatusCounts: async () => {
      const counts = {
        SCHEDULED: 0,
        SENT: 0,
        FAILED: 0,
        CANCELED: 0
      } as Record<string, number>;

      for (const item of reminders.values()) {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
      }

      return counts;
    },
    listRecentFailedReminders: async ({ limit }: { limit?: number } = {}) =>
      Array.from(reminders.values())
        .filter((item) => item.status === "FAILED")
        .slice(0, limit ?? 5)
  };

  return {
    env: {
      ADMIN_API_TOKEN: "test-token",
      LLM_ENABLED: true,
      OPENAI_API_KEY: "test"
    },
    governancePort: {
      getSnapshot: async () => ({
        evaluatedAt: new Date("2026-04-14T10:00:00.000Z"),
        tenantId: "tenant-1",
        waUserId: "u1",
        scope: "private",
        actor: {
          isBotAdmin: false,
          isPrivileged: false,
          permissionRole: "member",
          relationshipProfile: "member"
        },
        featureFlags: {},
        group: {
          exists: false
        },
        consent: {
          exists: true,
          status: "ACCEPTED",
          termsVersion: "2026-03"
        },
        access: {
          user: {
            exists: true,
            status: "PENDING",
            tier: "FREE",
            approvedBy: null,
            approvedAt: null,
            source: "persisted"
          },
          group: {
            exists: false,
            status: "UNKNOWN",
            tier: "UNKNOWN",
            approvedBy: null,
            approvedAt: null,
            source: "default"
          },
          effective: {
            source: "user",
            status: "PENDING",
            tier: "FREE"
          }
        },
        runtimePolicySignals: {}
      })
    },
    queue: {
      name: "reminders",
      getJobCounts: async () => ({ waiting: 0, active: 0, completed: 0, failed: 1, delayed: 0 }),
      remove: async () => undefined,
      add: async (_name: string, _data: unknown, _opts: unknown) => ({ id: "job-retry-1" })
    },
    metrics: {
      getSnapshot: async () => ({})
    },
    redis: {
      ping: async () => "PONG",
      get: async () => null
    },
    adminGovernanceRepository: repository,
    adminJobsRepository: jobsRepository
  } as any;
};

test("admin auth guard protects /admin routes", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const unauthorized = await app.inject({
    method: "GET",
    url: "/admin/v1/users"
  });

  assert.equal(unauthorized.statusCode, 401);

  const health = await app.inject({
    method: "GET",
    url: "/health"
  });

  assert.equal(health.statusCode, 200);
  assert.equal(health.json().service, "admin-api");

  await app.close();
});

test("user approval and block flow writes audit trail entries", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const approveResponse = await app.inject({
    method: "PATCH",
    url: "/admin/v1/users/u-123/access",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      status: "APPROVED",
      actor: "ops-admin"
    }
  });

  assert.equal(approveResponse.statusCode, 200);
  assert.equal(approveResponse.json().item.status, "APPROVED");

  const blockResponse = await app.inject({
    method: "PATCH",
    url: "/admin/v1/users/u-123/access",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      status: "BLOCKED",
      actor: "ops-admin"
    }
  });

  assert.equal(blockResponse.statusCode, 200);
  assert.equal(blockResponse.json().item.status, "BLOCKED");

  const auditResponse = await app.inject({
    method: "GET",
    url: "/admin/v1/audit",
    headers: {
      authorization: "Bearer test-token"
    }
  });

  assert.equal(auditResponse.statusCode, 200);
  const payload = auditResponse.json();
  assert.equal(payload.schemaVersion, "admin.audit.v1");
  assert.equal(payload.count >= 2, true);
  assert.equal(payload.items[0].subjectType, "USER");

  await app.close();
});

test("user and group license assignment flow updates tiers", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const userLicense = await app.inject({
    method: "PATCH",
    url: "/admin/v1/users/u-456/license",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      tier: "PRO",
      actor: "ops-admin"
    }
  });

  assert.equal(userLicense.statusCode, 200);
  assert.equal(userLicense.json().item.tier, "PRO");

  const groupLicense = await app.inject({
    method: "PATCH",
    url: "/admin/v1/groups/g-789/license",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      tier: "BASIC",
      actor: "ops-admin"
    }
  });

  assert.equal(groupLicense.statusCode, 200);
  assert.equal(groupLicense.json().item.tier, "BASIC");

  await app.close();
});

test("usage endpoints return stable admin-facing shape", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const userUsage = await app.inject({
    method: "GET",
    url: "/admin/v1/usage/users/u-123",
    headers: {
      authorization: "Bearer test-token"
    }
  });

  assert.equal(userUsage.statusCode, 200);
  const userPayload = userUsage.json();
  assert.equal(userPayload.schemaVersion, "admin.usage.user.v1");
  assert.equal(Array.isArray(userPayload.counters), true);
  assert.equal(typeof userPayload.summary.commandsExecuted, "number");

  const groupUsage = await app.inject({
    method: "GET",
    url: "/admin/v1/usage/groups/g-123",
    headers: {
      authorization: "Bearer test-token"
    }
  });

  assert.equal(groupUsage.statusCode, 200);
  const groupPayload = groupUsage.json();
  assert.equal(groupPayload.schemaVersion, "admin.usage.group.v1");
  assert.equal(groupPayload.subjectType, "GROUP");

  await app.close();
});

test("status endpoint returns dashboard-ready health summary", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const response = await app.inject({
    method: "GET",
    url: "/admin/v1/status",
    headers: {
      authorization: "Bearer test-token"
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.schemaVersion, "admin.status.v2");
  assert.equal(payload.version, "1.7.0");
  assert.equal(typeof payload.services.gateway.online, "boolean");
  assert.equal(typeof payload.reminders.FAILED, "number");
  assert.equal(Array.isArray(payload.failures.recentFailedReminders), true);

  await app.close();
});

test("failed reminders can be listed and retried", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const listResponse = await app.inject({
    method: "GET",
    url: "/admin/v1/reminders?status=FAILED",
    headers: {
      authorization: "Bearer test-token"
    }
  });

  assert.equal(listResponse.statusCode, 200);
  const listPayload = listResponse.json();
  assert.equal(listPayload.schemaVersion, "admin.reminders.v1");
  assert.equal(listPayload.count >= 1, true);
  assert.equal(listPayload.items[0].status, "FAILED");

  const retryResponse = await app.inject({
    method: "POST",
    url: "/admin/v1/reminders/r-failed-1/retry",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      actor: "ops-admin"
    }
  });

  assert.equal(retryResponse.statusCode, 200);
  const retryPayload = retryResponse.json();
  assert.equal(retryPayload.schemaVersion, "admin.reminder.retry.v1");
  assert.equal(retryPayload.item.status, "SCHEDULED");
  assert.equal(retryPayload.queue.jobId, "job-retry-1");

  await app.close();
});
