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
  const capabilities = [
    {
      key: "command.ping",
      displayName: "Ping",
      active: true,
      createdAt: new Date("2026-04-14T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-14T00:00:00.000Z").toISOString()
    },
    {
      key: "command.hidetag",
      displayName: "Hidetag",
      active: true,
      createdAt: new Date("2026-04-14T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-14T00:00:00.000Z").toISOString()
    }
  ];
  const bundles = [
    {
      key: "basic_chat",
      displayName: "Basic Chat",
      active: true,
      capabilities: ["command.ping"],
      createdAt: new Date("2026-04-14T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-14T00:00:00.000Z").toISOString()
    },
    {
      key: "moderation_tools",
      displayName: "Moderation Tools",
      active: true,
      capabilities: ["command.hidetag"],
      createdAt: new Date("2026-04-14T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-14T00:00:00.000Z").toISOString()
    }
  ];
  const userBundleAssignments = new Map<string, Set<string>>();
  const groupBundleAssignments = new Map<string, Set<string>>();
  const userOverrides = new Map<string, Map<string, "allow" | "deny">>();
  const groupOverrides = new Map<string, Map<string, "allow" | "deny">>();

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

  app.get("/admin/v1/governance/capabilities", async () => ({
    schemaVersion: "admin.governance.capabilities.v1",
    count: capabilities.length,
    items: capabilities
  }));
  app.get("/admin/v1/governance/bundles", async () => ({
    schemaVersion: "admin.governance.bundles.v1",
    count: bundles.length,
    items: bundles
  }));
  app.get("/admin/v1/governance/users/:waUserId/effective", async (request) => {
    const params = request.params as { waUserId: string };
    const user = users.get(params.waUserId);
    const assigned = Array.from(userBundleAssignments.get(params.waUserId) ?? new Set<string>());
    const overrides = Object.fromEntries((userOverrides.get(params.waUserId) ?? new Map<string, "allow" | "deny">()).entries());
    return {
      schemaVersion: "admin.governance.user.effective.v1",
      item: {
        tenantId: user?.tenantId ?? "tenant-1",
        subjectType: "USER",
        subjectId: params.waUserId,
        tier: user?.tier ?? "FREE",
        status: user?.status ?? "PENDING",
        assignedBundles: { user: assigned, group: [] },
        overrides: { user: overrides, group: {} },
        effectiveCapabilities: [
          {
            key: "command.ping",
            allow: true,
            source: "tier_default",
            denySource: null,
            tierDefaultAllowed: true,
            bundleAllowed: assigned.includes("basic_chat"),
            matchedBundles: assigned.includes("basic_chat") ? ["basic_chat"] : [],
            explicitAllowSource: null,
            explicitDenySources: []
          }
        ]
      }
    };
  });
  app.get("/admin/v1/governance/groups/:waGroupId/effective", async (request) => {
    const params = request.params as { waGroupId: string };
    const group = groups.get(params.waGroupId);
    const assigned = Array.from(groupBundleAssignments.get(params.waGroupId) ?? new Set<string>());
    const overrides = Object.fromEntries((groupOverrides.get(params.waGroupId) ?? new Map<string, "allow" | "deny">()).entries());
    return {
      schemaVersion: "admin.governance.group.effective.v1",
      item: {
        tenantId: group?.tenantId ?? "tenant-1",
        subjectType: "GROUP",
        subjectId: params.waGroupId,
        tier: group?.tier ?? "FREE",
        status: group?.status ?? "PENDING",
        assignedBundles: { user: [], group: assigned },
        overrides: { user: {}, group: overrides },
        effectiveCapabilities: [
          {
            key: "command.hidetag",
            allow: assigned.includes("moderation_tools") && overrides["command.hidetag"] !== "deny",
            source: assigned.includes("moderation_tools") ? "bundle" : "none",
            denySource: assigned.includes("moderation_tools") ? null : "missing_bundle",
            tierDefaultAllowed: false,
            bundleAllowed: assigned.includes("moderation_tools"),
            matchedBundles: assigned.includes("moderation_tools") ? ["moderation_tools"] : [],
            explicitAllowSource: overrides["command.hidetag"] === "allow" ? "group_override_allow" : null,
            explicitDenySources: overrides["command.hidetag"] === "deny" ? ["group_override_deny"] : []
          }
        ]
      }
    };
  });
  app.get("/admin/v1/governance/snapshot", async (request) => {
    const query = request.query as {
      waGroupId?: string;
      waUserId?: string;
      scope?: string;
      capability?: string;
    };
    const scope = query.scope === "group" ? "group" : "private";
    const capability = query.capability || (scope === "group" ? "conversation.group" : "conversation.direct");
    const group = query.waGroupId ? groups.get(query.waGroupId) : null;
    const assigned = query.waGroupId ? Array.from(groupBundleAssignments.get(query.waGroupId) ?? new Set<string>()) : [];
    const overrides = query.waGroupId
      ? Object.fromEntries((groupOverrides.get(query.waGroupId) ?? new Map<string, "allow" | "deny">()).entries())
      : {};

    const tierAllowsHidetag = group?.tier === "PRO" || group?.tier === "ROOT";
    const bundleAllowsHidetag = assigned.includes("moderation_tools");
    const overrideMode = overrides["command.hidetag"];

    const policyAllowForHidetag = overrideMode === "deny" ? false : tierAllowsHidetag || bundleAllowsHidetag;
    const approved = scope !== "group" || group?.status === "APPROVED";
    const allow = capability === "command.hidetag" ? approved && policyAllowForHidetag : approved;

    return {
      schemaVersion: "governance.snapshot.v1",
      decision: {
        allow,
        capabilityPolicy: {
          requested: capability,
          denySource:
            capability === "command.hidetag" && !policyAllowForHidetag ? (overrideMode === "deny" ? "explicit_override_deny" : "tier_default") : null
        }
      }
    };
  });
  app.put("/admin/v1/governance/users/:waUserId/bundles/:bundleKey", async (request) => {
    const params = request.params as { waUserId: string; bundleKey: string };
    const set = userBundleAssignments.get(params.waUserId) ?? new Set<string>();
    set.add(params.bundleKey);
    userBundleAssignments.set(params.waUserId, set);
    return { schemaVersion: "admin.governance.user.bundle.v1", item: { waUserId: params.waUserId, bundleKey: params.bundleKey } };
  });
  app.delete("/admin/v1/governance/users/:waUserId/bundles/:bundleKey", async (request) => {
    const params = request.params as { waUserId: string; bundleKey: string };
    const set = userBundleAssignments.get(params.waUserId) ?? new Set<string>();
    set.delete(params.bundleKey);
    userBundleAssignments.set(params.waUserId, set);
    return { schemaVersion: "admin.governance.user.bundle.v1", item: { waUserId: params.waUserId, bundleKey: params.bundleKey } };
  });
  app.put("/admin/v1/governance/groups/:waGroupId/bundles/:bundleKey", async (request) => {
    const params = request.params as { waGroupId: string; bundleKey: string };
    const set = groupBundleAssignments.get(params.waGroupId) ?? new Set<string>();
    set.add(params.bundleKey);
    groupBundleAssignments.set(params.waGroupId, set);
    return { schemaVersion: "admin.governance.group.bundle.v1", item: { waGroupId: params.waGroupId, bundleKey: params.bundleKey } };
  });
  app.delete("/admin/v1/governance/groups/:waGroupId/bundles/:bundleKey", async (request) => {
    const params = request.params as { waGroupId: string; bundleKey: string };
    const set = groupBundleAssignments.get(params.waGroupId) ?? new Set<string>();
    set.delete(params.bundleKey);
    groupBundleAssignments.set(params.waGroupId, set);
    return { schemaVersion: "admin.governance.group.bundle.v1", item: { waGroupId: params.waGroupId, bundleKey: params.bundleKey } };
  });
  app.put("/admin/v1/governance/users/:waUserId/capabilities/:capabilityKey", async (request) => {
    const params = request.params as { waUserId: string; capabilityKey: string };
    const body = request.body as { mode: "allow" | "deny" };
    const map = userOverrides.get(params.waUserId) ?? new Map<string, "allow" | "deny">();
    map.set(params.capabilityKey, body.mode);
    userOverrides.set(params.waUserId, map);
    return { schemaVersion: "admin.governance.user.capability.v1", item: { waUserId: params.waUserId, capabilityKey: params.capabilityKey, mode: body.mode } };
  });
  app.delete("/admin/v1/governance/users/:waUserId/capabilities/:capabilityKey", async (request) => {
    const params = request.params as { waUserId: string; capabilityKey: string };
    const map = userOverrides.get(params.waUserId) ?? new Map<string, "allow" | "deny">();
    map.delete(params.capabilityKey);
    userOverrides.set(params.waUserId, map);
    return { schemaVersion: "admin.governance.user.capability.v1", item: { waUserId: params.waUserId, capabilityKey: params.capabilityKey } };
  });
  app.put("/admin/v1/governance/groups/:waGroupId/capabilities/:capabilityKey", async (request) => {
    const params = request.params as { waGroupId: string; capabilityKey: string };
    const body = request.body as { mode: "allow" | "deny" };
    const map = groupOverrides.get(params.waGroupId) ?? new Map<string, "allow" | "deny">();
    map.set(params.capabilityKey, body.mode);
    groupOverrides.set(params.waGroupId, map);
    return { schemaVersion: "admin.governance.group.capability.v1", item: { waGroupId: params.waGroupId, capabilityKey: params.capabilityKey, mode: body.mode } };
  });
  app.delete("/admin/v1/governance/groups/:waGroupId/capabilities/:capabilityKey", async (request) => {
    const params = request.params as { waGroupId: string; capabilityKey: string };
    const map = groupOverrides.get(params.waGroupId) ?? new Map<string, "allow" | "deny">();
    map.delete(params.capabilityKey);
    groupOverrides.set(params.waGroupId, map);
    return { schemaVersion: "admin.governance.group.capability.v1", item: { waGroupId: params.waGroupId, capabilityKey: params.capabilityKey } };
  });

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

  const reapproveGroup = await callUiProxy(uiBaseUrl, "/admin/v1/groups/g-100/access", {
    method: "PATCH",
    body: JSON.stringify({ status: "APPROVED", actor: "ops-admin" })
  });
  assert.equal(reapproveGroup.status, 200);
  assert.equal(reapproveGroup.payload.item.status, "APPROVED");

  const snapshotBeforeBundle = await callUiProxy(
    uiBaseUrl,
    "/admin/v1/governance/snapshot?tenantId=tenant-1&waUserId=u-100&waGroupId=g-100&scope=group&capability=command.hidetag"
  );
  assert.equal(snapshotBeforeBundle.status, 200);
  assert.equal(snapshotBeforeBundle.payload.decision.allow, false);
  assert.equal(snapshotBeforeBundle.payload.decision.capabilityPolicy.denySource, "tier_default");

  const governanceCapabilities = await callUiProxy(uiBaseUrl, "/admin/v1/governance/capabilities");
  assert.equal(governanceCapabilities.status, 200);
  assert.equal(governanceCapabilities.payload.count >= 1, true);

  const governanceBundles = await callUiProxy(uiBaseUrl, "/admin/v1/governance/bundles");
  assert.equal(governanceBundles.status, 200);
  assert.equal(governanceBundles.payload.count >= 1, true);

  const assignGroupBundle = await callUiProxy(uiBaseUrl, "/admin/v1/governance/groups/g-100/bundles/moderation_tools", {
    method: "PUT",
    body: JSON.stringify({ actor: "ops-admin" })
  });
  assert.equal(assignGroupBundle.status, 200);

  const snapshotAfterBundle = await callUiProxy(
    uiBaseUrl,
    "/admin/v1/governance/snapshot?tenantId=tenant-1&waUserId=u-100&waGroupId=g-100&scope=group&capability=command.hidetag"
  );
  assert.equal(snapshotAfterBundle.status, 200);
  assert.equal(snapshotAfterBundle.payload.decision.allow, true);

  const setGroupCapabilityOverride = await callUiProxy(uiBaseUrl, "/admin/v1/governance/groups/g-100/capabilities/command.hidetag", {
    method: "PUT",
    body: JSON.stringify({ mode: "deny", actor: "ops-admin" })
  });
  assert.equal(setGroupCapabilityOverride.status, 200);

  const snapshotAfterOverride = await callUiProxy(
    uiBaseUrl,
    "/admin/v1/governance/snapshot?tenantId=tenant-1&waUserId=u-100&waGroupId=g-100&scope=group&capability=command.hidetag"
  );
  assert.equal(snapshotAfterOverride.status, 200);
  assert.equal(snapshotAfterOverride.payload.decision.allow, false);
  assert.equal(snapshotAfterOverride.payload.decision.capabilityPolicy.denySource, "explicit_override_deny");

  const effectiveGroup = await callUiProxy(uiBaseUrl, "/admin/v1/governance/groups/g-100/effective");
  assert.equal(effectiveGroup.status, 200);
  assert.equal(effectiveGroup.payload.schemaVersion, "admin.governance.group.effective.v1");

  const clearGroupCapabilityOverride = await callUiProxy(uiBaseUrl, "/admin/v1/governance/groups/g-100/capabilities/command.hidetag", {
    method: "DELETE",
    body: JSON.stringify({ actor: "ops-admin" })
  });
  assert.equal(clearGroupCapabilityOverride.status, 200);

  const snapshotAfterClear = await callUiProxy(
    uiBaseUrl,
    "/admin/v1/governance/snapshot?tenantId=tenant-1&waUserId=u-100&waGroupId=g-100&scope=group&capability=command.hidetag"
  );
  assert.equal(snapshotAfterClear.status, 200);
  assert.equal(snapshotAfterClear.payload.decision.allow, true);

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
