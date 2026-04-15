import { strict as assert } from "node:assert";
import { AddressInfo } from "node:net";
import test from "node:test";
import Fastify from "fastify";
import { createAdminUiServer } from "../src/server.js";

const buildMockAdminApi = async () => {
  const app = Fastify();

  const users = new Map<string, any>([
    [
      "u-100",
      {
        tenantId: "tenant-1",
        waUserId: "u-100",
        displayName: "User 100",
        status: "PENDING",
        tier: "FREE",
        updatedAt: new Date("2026-04-14T11:00:00.000Z").toISOString()
      }
    ]
  ]);

  const groups = new Map<string, any>([
    [
      "g-100",
      {
        tenantId: "tenant-1",
        waGroupId: "g-100",
        groupName: "Group 100",
        status: "PENDING",
        tier: "FREE",
        updatedAt: new Date("2026-04-14T11:00:00.000Z").toISOString()
      }
    ]
  ]);

  const reminders = new Map<string, any>([
    [
      "r-100",
      {
        id: "r-100",
        publicId: "RMD100",
        tenantId: "tenant-1",
        waUserId: "u-100",
        message: "Retry me",
        remindAt: new Date("2026-04-14T10:00:00.000Z").toISOString(),
        status: "FAILED",
        updatedAt: new Date("2026-04-14T10:02:00.000Z").toISOString()
      }
    ]
  ]);

  const audit: any[] = [];

  const withAudit = (entry: any) => {
    audit.unshift({
      createdAt: new Date("2026-04-14T12:00:00.000Z").toISOString(),
      ...entry
    });
  };

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    const auth = request.headers.authorization;
    if (auth !== "Bearer test-token") {
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized"
        }
      });
    }
  });

  app.get("/health", async () => ({ ok: true, service: "mock-admin-api", version: "1.7.0" }));

  app.get("/admin/v1/status", async () => ({
    schemaVersion: "admin.status.v2",
    service: "admin-api",
    version: "1.7.0",
    projectVersion: "1.7.0",
    checkedAt: new Date("2026-04-14T12:00:00.000Z").toISOString(),
    services: {
      gateway: { online: true, connected: true, lastHeartbeat: new Date("2026-04-14T11:59:30.000Z").toISOString(), ageSeconds: 2 },
      worker: { online: true, lastHeartbeat: new Date("2026-04-14T11:59:32.000Z").toISOString(), ageSeconds: 1 },
      adminApi: { online: true, ok: true, lastHeartbeat: new Date("2026-04-14T12:00:00.000Z").toISOString(), ageSeconds: 0 },
      mediaResolverApi: { configured: true, online: false, ok: false, status: "unavailable", checkedAt: new Date().toISOString(), latencyMs: 11, httpStatus: 503 },
      assistantApi: { configured: false, online: false, ok: false, status: "not_configured", checkedAt: new Date().toISOString(), latencyMs: null, httpStatus: null }
    },
    db: { ok: true },
    redis: { ok: true },
    queue: { name: "reminders", waiting: 0, active: 0, delayed: 0, completed: 1, failed: 1 },
    reminders: { SCHEDULED: 0, SENT: 0, FAILED: 1, CANCELED: 0, total: 1 },
    resolver: { health: { configured: true, ok: false, status: "unavailable" } },
    failures: {
      queueFailedJobs: 1,
      failedReminders: 1,
      recentFailedReminders: Array.from(reminders.values())
    },
    warnings: ["media-resolver-api is unavailable"]
  }));

  app.get("/admin/metrics/summary", async () => ({ commands_executed_total: 12, reminders_sent_total: 5 }));

  app.get("/admin/v1/users", async () => ({ schemaVersion: "admin.users.v1", count: users.size, items: Array.from(users.values()) }));
  app.patch("/admin/v1/users/:waUserId/access", async (request) => {
    const params = request.params as { waUserId: string };
    const body = request.body as { status: string; actor?: string };
    const current = users.get(params.waUserId);
    const next = { ...current, status: body.status, updatedAt: new Date("2026-04-14T12:00:00.000Z").toISOString() };
    users.set(params.waUserId, next);
    withAudit({ action: "USER_ACCESS_STATUS_UPDATED", actor: body.actor ?? "admin-ui", subjectType: "USER", subjectId: params.waUserId, before: current, after: next });
    return { schemaVersion: "admin.user.access.v1", item: next };
  });
  app.patch("/admin/v1/users/:waUserId/license", async (request) => {
    const params = request.params as { waUserId: string };
    const body = request.body as { tier: string; actor?: string };
    const current = users.get(params.waUserId);
    const next = { ...current, tier: body.tier, updatedAt: new Date("2026-04-14T12:00:00.000Z").toISOString() };
    users.set(params.waUserId, next);
    withAudit({ action: "USER_LICENSE_UPDATED", actor: body.actor ?? "admin-ui", subjectType: "USER", subjectId: params.waUserId, before: current, after: next });
    return { schemaVersion: "admin.user.license.v1", item: next };
  });

  app.get("/admin/v1/groups", async () => ({ schemaVersion: "admin.groups.v1", count: groups.size, items: Array.from(groups.values()) }));
  app.patch("/admin/v1/groups/:waGroupId/access", async (request) => {
    const params = request.params as { waGroupId: string };
    const body = request.body as { status: string; actor?: string };
    const current = groups.get(params.waGroupId);
    const next = { ...current, status: body.status, updatedAt: new Date("2026-04-14T12:00:00.000Z").toISOString() };
    groups.set(params.waGroupId, next);
    withAudit({ action: "GROUP_ACCESS_STATUS_UPDATED", actor: body.actor ?? "admin-ui", subjectType: "GROUP", subjectId: params.waGroupId, before: current, after: next });
    return { schemaVersion: "admin.group.access.v1", item: next };
  });
  app.patch("/admin/v1/groups/:waGroupId/license", async (request) => {
    const params = request.params as { waGroupId: string };
    const body = request.body as { tier: string; actor?: string };
    const current = groups.get(params.waGroupId);
    const next = { ...current, tier: body.tier, updatedAt: new Date("2026-04-14T12:00:00.000Z").toISOString() };
    groups.set(params.waGroupId, next);
    withAudit({ action: "GROUP_LICENSE_UPDATED", actor: body.actor ?? "admin-ui", subjectType: "GROUP", subjectId: params.waGroupId, before: current, after: next });
    return { schemaVersion: "admin.group.license.v1", item: next };
  });

  app.get("/admin/v1/licenses/plans", async () => ({
    schemaVersion: "admin.license.plans.v1",
    count: 4,
    plans: [
      { tier: "FREE", displayName: "Free", description: "Default", active: true, capabilityDefaults: { support: "community" } },
      { tier: "BASIC", displayName: "Basic", description: "Basic", active: true, capabilityDefaults: { support: "standard" } },
      { tier: "PRO", displayName: "Pro", description: "Pro", active: true, capabilityDefaults: { support: "priority" } },
      { tier: "ROOT", displayName: "Root", description: "Root", active: true, capabilityDefaults: { support: "owner" } }
    ]
  }));

  app.get("/admin/v1/audit", async () => ({ schemaVersion: "admin.audit.v1", count: audit.length, items: audit }));

  app.get("/admin/v1/reminders", async (request) => {
    const query = request.query as { status?: string };
    const items = Array.from(reminders.values()).filter((item) => !query.status || item.status === query.status);
    return { schemaVersion: "admin.reminders.v1", count: items.length, items };
  });

  app.post("/admin/v1/reminders/:reminderId/retry", async (request) => {
    const params = request.params as { reminderId: string };
    const current = reminders.get(params.reminderId);
    const next = { ...current, status: "SCHEDULED", updatedAt: new Date("2026-04-14T12:00:00.000Z").toISOString() };
    reminders.set(params.reminderId, next);
    return {
      schemaVersion: "admin.reminder.retry.v1",
      item: next,
      queue: {
        name: "reminders",
        jobId: "job-100",
        delayMs: 0,
        runAt: new Date("2026-04-14T12:00:00.000Z").toISOString()
      }
    };
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as AddressInfo).port;

  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    state: {
      users,
      groups,
      reminders,
      audit
    },
    close: async () => app.close()
  };
};

const callUiProxy = async (baseUrl: string, path: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}/ui-api${path}`, {
    ...init,
    headers: {
      "x-admin-token": "test-token",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });

  const payload = await response.json();
  return {
    status: response.status,
    payload
  };
};

test("admin-ui proxy supports admin-api round-trips for dashboard, users/groups, audit, and reminders", async () => {
  const mockApi = await buildMockAdminApi();
  const uiServer = await createAdminUiServer({
    port: 0,
    defaultAdminApiBaseUrl: mockApi.baseUrl
  });
  await uiServer.start();

  const uiPort = (uiServer.app.server.address() as AddressInfo).port;
  const uiBaseUrl = `http://127.0.0.1:${uiPort}`;

  const dashboard = await callUiProxy(uiBaseUrl, "/admin/v1/status");
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.payload.schemaVersion, "admin.status.v2");
  assert.equal(Array.isArray(dashboard.payload.warnings), true);

  const users = await callUiProxy(uiBaseUrl, "/admin/v1/users");
  assert.equal(users.status, 200);
  assert.equal(users.payload.count, 1);

  const approveUser = await callUiProxy(uiBaseUrl, "/admin/v1/users/u-100/access", {
    method: "PATCH",
    body: JSON.stringify({ status: "APPROVED", actor: "ops-admin" })
  });
  assert.equal(approveUser.status, 200);
  assert.equal(approveUser.payload.item.status, "APPROVED");

  const blockUser = await callUiProxy(uiBaseUrl, "/admin/v1/users/u-100/access", {
    method: "PATCH",
    body: JSON.stringify({ status: "BLOCKED", actor: "ops-admin" })
  });
  assert.equal(blockUser.status, 200);
  assert.equal(blockUser.payload.item.status, "BLOCKED");

  const updateUserTier = await callUiProxy(uiBaseUrl, "/admin/v1/users/u-100/license", {
    method: "PATCH",
    body: JSON.stringify({ tier: "PRO", actor: "ops-admin" })
  });
  assert.equal(updateUserTier.status, 200);
  assert.equal(updateUserTier.payload.item.tier, "PRO");

  const blockGroup = await callUiProxy(uiBaseUrl, "/admin/v1/groups/g-100/access", {
    method: "PATCH",
    body: JSON.stringify({ status: "BLOCKED", actor: "ops-admin" })
  });
  assert.equal(blockGroup.status, 200);
  assert.equal(blockGroup.payload.item.status, "BLOCKED");

  const updateGroupTier = await callUiProxy(uiBaseUrl, "/admin/v1/groups/g-100/license", {
    method: "PATCH",
    body: JSON.stringify({ tier: "BASIC", actor: "ops-admin" })
  });
  assert.equal(updateGroupTier.status, 200);
  assert.equal(updateGroupTier.payload.item.tier, "BASIC");

  const audit = await callUiProxy(uiBaseUrl, "/admin/v1/audit");
  assert.equal(audit.status, 200);
  assert.equal(audit.payload.count >= 5, true);

  const reminders = await callUiProxy(uiBaseUrl, "/admin/v1/reminders?status=FAILED");
  assert.equal(reminders.status, 200);
  assert.equal(reminders.payload.count, 1);
  assert.equal(reminders.payload.items[0].status, "FAILED");

  const retryReminder = await callUiProxy(uiBaseUrl, "/admin/v1/reminders/r-100/retry", {
    method: "POST",
    body: JSON.stringify({ actor: "ops-admin" })
  });
  assert.equal(retryReminder.status, 200);
  assert.equal(retryReminder.payload.item.status, "SCHEDULED");

  const unauthorized = await fetch(`${uiBaseUrl}/ui-api/admin/v1/users`, {
    headers: {
      "x-admin-token": "wrong-token"
    }
  });
  assert.equal(unauthorized.status, 401);

  await uiServer.close();
  await mockApi.close();
});
