import { strict as assert } from "node:assert";
import test from "node:test";
import Fastify from "fastify";
import { registerAdminApiRoutes } from "../src/http/routes.js";

const buildRuntime = () => {
  const users = new Map<string, any>();
  const groups = new Map<string, any>();
  const audit: any[] = [];
  const reminders = new Map<string, any>();
  const capabilities = [
    {
      key: "command.ping",
      displayName: "Ping",
      description: "Ping command",
      category: "command",
      bundles: ["basic_chat"],
      active: true,
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
      updatedAt: new Date("2026-04-14T00:00:00.000Z")
    },
    {
      key: "command.hidetag",
      displayName: "Hidetag",
      description: "Hidetag command",
      category: "moderation",
      bundles: ["moderation_tools"],
      active: true,
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
      updatedAt: new Date("2026-04-14T00:00:00.000Z")
    }
  ];
  const bundles = [
    { key: "basic_chat", displayName: "Basic Chat", active: true, capabilities: ["command.ping"], createdAt: new Date("2026-04-14T00:00:00.000Z"), updatedAt: new Date("2026-04-14T00:00:00.000Z") },
    { key: "moderation_tools", displayName: "Moderation Tools", active: true, capabilities: ["command.hidetag"], createdAt: new Date("2026-04-14T00:00:00.000Z"), updatedAt: new Date("2026-04-14T00:00:00.000Z") }
  ];
  const userBundleAssignments = new Map<string, Set<string>>();
  const groupBundleAssignments = new Map<string, Set<string>>();
  const userOverrides = new Map<string, Map<string, "allow" | "deny">>();
  const groupOverrides = new Map<string, Map<string, "allow" | "deny">>();

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
      status: "APPROVED",
      tier: "FREE",
      approvedBy: "system:private-default",
      approvedAt: new Date("2026-04-14T00:00:00.000Z"),
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
    listCapabilityDefinitions: async () =>
      capabilities.map((capability) => ({
        ...capability,
        bundles: bundles.filter((bundle) => bundle.capabilities.includes(capability.key)).map((bundle) => bundle.key)
      })),
    listCapabilityBundles: async () => bundles,
    createCapabilityBundle: async ({
      key,
      displayName,
      description,
      active,
      capabilityKeys
    }: {
      key: string;
      displayName: string;
      description?: string | null;
      active?: boolean;
      capabilityKeys?: string[];
    }) => {
      if (bundles.some((bundle) => bundle.key === key)) throw new Error(`bundle_exists:${key}`);
      const next = {
        key,
        displayName,
        description: description ?? null,
        active: active ?? true,
        capabilities: capabilityKeys ?? [],
        createdAt: new Date(nowIso()),
        updatedAt: new Date(nowIso())
      };
      bundles.push(next);
      return next;
    },
    updateCapabilityBundle: async ({
      bundleKey,
      displayName,
      description,
      active,
      capabilityKeys
    }: {
      bundleKey: string;
      displayName?: string;
      description?: string | null;
      active?: boolean;
      capabilityKeys?: string[];
    }) => {
      const index = bundles.findIndex((bundle) => bundle.key === bundleKey);
      if (index < 0) throw new Error(`bundle_not_found:${bundleKey}`);
      const current = bundles[index];
      const next = {
        ...current,
        displayName: displayName ?? current.displayName,
        description: description !== undefined ? description : current.description,
        active: active ?? current.active,
        capabilities: capabilityKeys ?? current.capabilities,
        updatedAt: new Date(nowIso())
      };
      bundles[index] = next;
      return next;
    },
    assignCapabilityToBundle: async ({ bundleKey, capabilityKey }: { bundleKey: string; capabilityKey: string }) => {
      const bundle = bundles.find((item) => item.key === bundleKey);
      if (!bundle) throw new Error(`bundle_not_found:${bundleKey}`);
      if (!capabilities.some((capability) => capability.key === capabilityKey)) throw new Error(`capability_not_found:${capabilityKey}`);
      if (!bundle.capabilities.includes(capabilityKey)) bundle.capabilities.push(capabilityKey);
      bundle.updatedAt = new Date(nowIso());
      return { bundleKey, capabilityKey };
    },
    removeCapabilityFromBundle: async ({ bundleKey, capabilityKey }: { bundleKey: string; capabilityKey: string }) => {
      const bundle = bundles.find((item) => item.key === bundleKey);
      if (!bundle) throw new Error(`bundle_not_found:${bundleKey}`);
      bundle.capabilities = bundle.capabilities.filter((item) => item !== capabilityKey);
      bundle.updatedAt = new Date(nowIso());
      return { bundleKey, capabilityKey };
    },
    getGovernanceDefaults: async () => ({
      defaults: {
        privateUser: { status: "APPROVED", tier: "FREE", source: "system_default" },
        group: { status: "PENDING", tier: "FREE", source: "system_default" }
      },
      onboarding: {
        privateAssistantEnabled: true,
        serviceExplanationEnabled: true,
        basicQuoteHelpEnabled: true
      },
      governance: {
        separationRule: "private_and_group_defaults_are_independent"
      },
      preSales: {
        readiness: "placeholder_only",
        serviceCatalog: {
          schemaVersion: "services_net.service_catalog.v1",
          source: "manual_placeholder",
          entries: 0
        },
        faq: {
          schemaVersion: "services_net.faq.v1",
          source: "manual_placeholder",
          entries: 0
        }
      }
    }),
    getUserEffectiveCapabilityPolicy: async ({ waUserId }: { waUserId: string }) => {
      const user = ensureUser(waUserId);
      const assigned = Array.from(userBundleAssignments.get(waUserId) ?? new Set<string>());
      const overrideMap = userOverrides.get(waUserId) ?? new Map<string, "allow" | "deny">();
      return {
        tenantId: user.tenantId,
        subjectType: "USER",
        subjectId: waUserId,
        tier: user.tier,
        status: user.status,
        assignedBundles: { user: assigned, group: [] },
        overrides: {
          user: Object.fromEntries(overrideMap.entries()),
          group: {}
        },
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
          },
          {
            key: "command.hidetag",
            allow: assigned.includes("moderation_tools") && overrideMap.get("command.hidetag") !== "deny",
            source: assigned.includes("moderation_tools") ? "bundle" : "none",
            denySource: assigned.includes("moderation_tools") ? null : "missing_bundle",
            tierDefaultAllowed: false,
            bundleAllowed: assigned.includes("moderation_tools"),
            matchedBundles: assigned.includes("moderation_tools") ? ["moderation_tools"] : [],
            explicitAllowSource: overrideMap.get("command.hidetag") === "allow" ? "user_override_allow" : null,
            explicitDenySources: overrideMap.get("command.hidetag") === "deny" ? ["user_override_deny"] : []
          }
        ]
      };
    },
    getGroupEffectiveCapabilityPolicy: async ({ waGroupId }: { waGroupId: string }) => {
      const group = ensureGroup(waGroupId);
      const assigned = Array.from(groupBundleAssignments.get(waGroupId) ?? new Set<string>());
      const overrideMap = groupOverrides.get(waGroupId) ?? new Map<string, "allow" | "deny">();
      return {
        tenantId: group.tenantId,
        subjectType: "GROUP",
        subjectId: waGroupId,
        tier: group.tier,
        status: group.status,
        assignedBundles: { user: [], group: assigned },
        overrides: {
          user: {},
          group: Object.fromEntries(overrideMap.entries())
        },
        effectiveCapabilities: [
          {
            key: "command.hidetag",
            allow: assigned.includes("moderation_tools") && overrideMap.get("command.hidetag") !== "deny",
            source: assigned.includes("moderation_tools") ? "bundle" : "none",
            denySource: assigned.includes("moderation_tools") ? null : "missing_bundle",
            tierDefaultAllowed: false,
            bundleAllowed: assigned.includes("moderation_tools"),
            matchedBundles: assigned.includes("moderation_tools") ? ["moderation_tools"] : [],
            explicitAllowSource: overrideMap.get("command.hidetag") === "allow" ? "group_override_allow" : null,
            explicitDenySources: overrideMap.get("command.hidetag") === "deny" ? ["group_override_deny"] : []
          }
        ]
      };
    },
    assignUserBundle: async ({ waUserId, bundleKey }: { waUserId: string; bundleKey: string }) => {
      const set = userBundleAssignments.get(waUserId) ?? new Set<string>();
      set.add(bundleKey);
      userBundleAssignments.set(waUserId, set);
      return { waUserId, bundleKey };
    },
    removeUserBundle: async ({ waUserId, bundleKey }: { waUserId: string; bundleKey: string }) => {
      const set = userBundleAssignments.get(waUserId) ?? new Set<string>();
      set.delete(bundleKey);
      userBundleAssignments.set(waUserId, set);
      return { waUserId, bundleKey };
    },
    assignGroupBundle: async ({ waGroupId, bundleKey }: { waGroupId: string; bundleKey: string }) => {
      const set = groupBundleAssignments.get(waGroupId) ?? new Set<string>();
      set.add(bundleKey);
      groupBundleAssignments.set(waGroupId, set);
      return { waGroupId, bundleKey };
    },
    removeGroupBundle: async ({ waGroupId, bundleKey }: { waGroupId: string; bundleKey: string }) => {
      const set = groupBundleAssignments.get(waGroupId) ?? new Set<string>();
      set.delete(bundleKey);
      groupBundleAssignments.set(waGroupId, set);
      return { waGroupId, bundleKey };
    },
    setUserCapabilityOverride: async ({ waUserId, capabilityKey, mode }: { waUserId: string; capabilityKey: string; mode: "allow" | "deny" }) => {
      const overrides = userOverrides.get(waUserId) ?? new Map<string, "allow" | "deny">();
      overrides.set(capabilityKey, mode);
      userOverrides.set(waUserId, overrides);
      return { waUserId, capabilityKey, mode };
    },
    clearUserCapabilityOverride: async ({ waUserId, capabilityKey }: { waUserId: string; capabilityKey: string }) => {
      const overrides = userOverrides.get(waUserId) ?? new Map<string, "allow" | "deny">();
      overrides.delete(capabilityKey);
      userOverrides.set(waUserId, overrides);
      return { waUserId, capabilityKey };
    },
    setGroupCapabilityOverride: async ({ waGroupId, capabilityKey, mode }: { waGroupId: string; capabilityKey: string; mode: "allow" | "deny" }) => {
      const overrides = groupOverrides.get(waGroupId) ?? new Map<string, "allow" | "deny">();
      overrides.set(capabilityKey, mode);
      groupOverrides.set(waGroupId, overrides);
      return { waGroupId, capabilityKey, mode };
    },
    clearGroupCapabilityOverride: async ({ waGroupId, capabilityKey }: { waGroupId: string; capabilityKey: string }) => {
      const overrides = groupOverrides.get(waGroupId) ?? new Map<string, "allow" | "deny">();
      overrides.delete(capabilityKey);
      groupOverrides.set(waGroupId, overrides);
      return { waGroupId, capabilityKey };
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
      getSnapshot: async (input: any) => {
        const scope = input?.context?.scope === "group" ? "group" : "private";
        const tenantId = input?.tenant?.id ?? "tenant-1";
        const waUserId = input?.user?.waUserId ?? "u1";
        const waGroupId = input?.group?.waGroupId;
        const user = ensureUser(waUserId);
        const group = waGroupId ? ensureGroup(waGroupId) : null;
        const userAssignmentSet = userBundleAssignments.get(waUserId) ?? new Set<string>();
        const groupAssignmentSet = waGroupId ? groupBundleAssignments.get(waGroupId) ?? new Set<string>() : new Set<string>();
        const userOverrideMap = userOverrides.get(waUserId) ?? new Map<string, "allow" | "deny">();
        const groupOverrideMap = waGroupId ? groupOverrides.get(waGroupId) ?? new Map<string, "allow" | "deny">() : new Map<string, "allow" | "deny">();

        return {
          evaluatedAt: new Date("2026-04-14T10:00:00.000Z"),
          tenantId,
          waUserId,
          waGroupId,
          scope,
          actor: {
            isBotAdmin: false,
            isPrivileged: false,
            permissionRole: input?.user?.permissionRole ?? "member",
            relationshipProfile: "member",
            role: input?.user?.permissionRole?.toUpperCase?.() === "ROOT" ? "ROOT" : "MEMBER"
          },
          featureFlags: {},
          group: {
            exists: Boolean(group),
            allowed: true,
            chatMode: "on",
            botIsAdmin: true,
            botAdminCheckedAt: new Date("2026-04-14T09:59:00.000Z")
          },
          consent: {
            exists: true,
            status: "ACCEPTED",
            termsVersion: "2026-03"
          },
          access: {
            user: {
              exists: true,
              status: user.status,
              tier: user.tier,
              approvedBy: user.approvedBy,
              approvedAt: user.approvedAt,
              source: "persisted"
            },
            group: {
              exists: Boolean(group),
              status: group ? group.status : "UNKNOWN",
              tier: group ? group.tier : "UNKNOWN",
              approvedBy: group?.approvedBy ?? null,
              approvedAt: group?.approvedAt ?? null,
              source: group ? "persisted" : "default"
            },
            effective:
              scope === "group"
                ? {
                    source: "group",
                    status: group ? group.status : "UNKNOWN",
                    tier: group ? group.tier : "UNKNOWN"
                  }
                : {
                    source: "user",
                    status: user.status,
                    tier: user.tier
                  }
          },
          capabilityPolicy: {
            definitions: capabilities.map((capability) => ({
              key: capability.key,
              displayName: capability.displayName,
              active: capability.active
            })),
            bundles: bundles.map((bundle) => ({
              key: bundle.key,
              displayName: bundle.displayName,
              active: bundle.active,
              capabilities: bundle.capabilities
            })),
            tierDefaultBundles: {
              FREE: ["basic_chat"],
              BASIC: ["basic_chat"],
              PRO: ["basic_chat", "moderation_tools"],
              ROOT: ["basic_chat", "moderation_tools"]
            },
            assignments: {
              user: Array.from(userAssignmentSet),
              group: Array.from(groupAssignmentSet)
            },
            overrides: {
              user: Object.fromEntries(userOverrideMap.entries()),
              group: Object.fromEntries(groupOverrideMap.entries())
            }
          },
          runtimePolicySignals: {
            botIsGroupAdmin: true
          }
        };
      }
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

test("first-seen defaults keep private and group governance policies separated", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const userResponse = await app.inject({
    method: "GET",
    url: "/admin/v1/users/u-new-private",
    headers: {
      authorization: "Bearer test-token"
    }
  });
  assert.equal(userResponse.statusCode, 200);
  assert.equal(userResponse.json().item.status, "APPROVED");
  assert.equal(userResponse.json().item.tier, "FREE");

  const groupResponse = await app.inject({
    method: "GET",
    url: "/admin/v1/groups/g-new-group",
    headers: {
      authorization: "Bearer test-token"
    }
  });
  assert.equal(groupResponse.statusCode, 200);
  assert.equal(groupResponse.json().item.status, "PENDING");
  assert.equal(groupResponse.json().item.tier, "FREE");

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

test("governance capability and bundle endpoints support assignment and overrides", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const capabilities = await app.inject({
    method: "GET",
    url: "/admin/v1/governance/capabilities",
    headers: {
      authorization: "Bearer test-token"
    }
  });
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.json().schemaVersion, "admin.governance.capabilities.v1");
  assert.equal(capabilities.json().count >= 1, true);

  const bundles = await app.inject({
    method: "GET",
    url: "/admin/v1/governance/bundles",
    headers: {
      authorization: "Bearer test-token"
    }
  });
  assert.equal(bundles.statusCode, 200);
  assert.equal(bundles.json().schemaVersion, "admin.governance.bundles.v1");
  assert.equal(bundles.json().count >= 1, true);

  const assignGroupBundle = await app.inject({
    method: "PUT",
    url: "/admin/v1/governance/groups/g-789/bundles/moderation_tools",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      actor: "ops-admin"
    }
  });
  assert.equal(assignGroupBundle.statusCode, 200);

  const setGroupOverride = await app.inject({
    method: "PUT",
    url: "/admin/v1/governance/groups/g-789/capabilities/command.hidetag",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      mode: "deny",
      actor: "ops-admin"
    }
  });
  assert.equal(setGroupOverride.statusCode, 200);
  assert.equal(setGroupOverride.json().item.mode, "deny");

  const effectiveGroup = await app.inject({
    method: "GET",
    url: "/admin/v1/governance/groups/g-789/effective",
    headers: {
      authorization: "Bearer test-token"
    }
  });
  assert.equal(effectiveGroup.statusCode, 200);
  assert.equal(effectiveGroup.json().schemaVersion, "admin.governance.group.effective.v1");

  const clearGroupOverride = await app.inject({
    method: "DELETE",
    url: "/admin/v1/governance/groups/g-789/capabilities/command.hidetag",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      actor: "ops-admin"
    }
  });
  assert.equal(clearGroupOverride.statusCode, 200);

  await app.close();
});

test("governance bundle catalog can be created/edited and settings expose defaults", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const createBundle = await app.inject({
    method: "POST",
    url: "/admin/v1/governance/bundles",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      key: "onboarding_plus",
      displayName: "Onboarding Plus",
      description: "Onboarding access package",
      capabilityKeys: ["command.ping"],
      actor: "ops-admin"
    }
  });
  assert.equal(createBundle.statusCode, 200);
  assert.equal(createBundle.json().schemaVersion, "admin.governance.bundle.v1");
  assert.equal(createBundle.json().item.key, "onboarding_plus");

  const addCapability = await app.inject({
    method: "PUT",
    url: "/admin/v1/governance/bundles/onboarding_plus/capabilities/command.hidetag",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      actor: "ops-admin"
    }
  });
  assert.equal(addCapability.statusCode, 200);
  assert.equal(addCapability.json().schemaVersion, "admin.governance.bundle.capability.v1");

  const patchBundle = await app.inject({
    method: "PATCH",
    url: "/admin/v1/governance/bundles/onboarding_plus",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      displayName: "Onboarding Plus Updated",
      capabilityKeys: ["command.ping", "command.hidetag"],
      actor: "ops-admin"
    }
  });
  assert.equal(patchBundle.statusCode, 200);
  assert.equal(patchBundle.json().item.displayName, "Onboarding Plus Updated");
  assert.equal(patchBundle.json().item.capabilities.includes("command.hidetag"), true);

  const settings = await app.inject({
    method: "GET",
    url: "/admin/v1/governance/settings",
    headers: {
      authorization: "Bearer test-token"
    }
  });
  assert.equal(settings.statusCode, 200);
  assert.equal(settings.json().schemaVersion, "admin.governance.settings.v1");
  assert.equal(settings.json().item.defaults.privateUser.status, "APPROVED");
  assert.equal(settings.json().item.defaults.group.status, "PENDING");
  assert.equal(settings.json().item.preSales.readiness, "placeholder_only");
  assert.equal(settings.json().item.preSales.serviceCatalog.schemaVersion, "services_net.service_catalog.v1");

  await app.close();
});

test("admin governance mutations round-trip into runtime snapshot enforcement", async () => {
  const app = Fastify();
  registerAdminApiRoutes(app as any, buildRuntime());

  const approveGroup = await app.inject({
    method: "PATCH",
    url: "/admin/v1/groups/g-789/access",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      status: "APPROVED",
      actor: "ops-admin"
    }
  });
  assert.equal(approveGroup.statusCode, 200);

  const setGroupTier = await app.inject({
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
  assert.equal(setGroupTier.statusCode, 200);

  const snapshotBefore = await app.inject({
    method: "GET",
    url: "/admin/v1/governance/snapshot?tenantId=tenant-1&waUserId=u-123&waGroupId=g-789&scope=group&capability=command.hidetag",
    headers: {
      authorization: "Bearer test-token"
    }
  });
  assert.equal(snapshotBefore.statusCode, 200);
  assert.equal(snapshotBefore.json().decision.allow, false);
  assert.equal(snapshotBefore.json().decision.capabilityPolicy.denySource, "tier_default");

  const assignBundle = await app.inject({
    method: "PUT",
    url: "/admin/v1/governance/groups/g-789/bundles/moderation_tools",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      actor: "ops-admin"
    }
  });
  assert.equal(assignBundle.statusCode, 200);

  const snapshotAfterBundle = await app.inject({
    method: "GET",
    url: "/admin/v1/governance/snapshot?tenantId=tenant-1&waUserId=u-123&waGroupId=g-789&scope=group&capability=command.hidetag",
    headers: {
      authorization: "Bearer test-token"
    }
  });
  assert.equal(snapshotAfterBundle.statusCode, 200);
  assert.equal(snapshotAfterBundle.json().decision.allow, true);

  const denyOverride = await app.inject({
    method: "PUT",
    url: "/admin/v1/governance/groups/g-789/capabilities/command.hidetag",
    headers: {
      authorization: "Bearer test-token"
    },
    payload: {
      mode: "deny",
      actor: "ops-admin"
    }
  });
  assert.equal(denyOverride.statusCode, 200);

  const snapshotAfterOverride = await app.inject({
    method: "GET",
    url: "/admin/v1/governance/snapshot?tenantId=tenant-1&waUserId=u-123&waGroupId=g-789&scope=group&capability=command.hidetag",
    headers: {
      authorization: "Bearer test-token"
    }
  });
  assert.equal(snapshotAfterOverride.statusCode, 200);
  assert.equal(snapshotAfterOverride.json().decision.allow, false);
  assert.equal(snapshotAfterOverride.json().decision.capabilityPolicy.denySource, "explicit_override_deny");

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
  assert.equal(payload.version, "1.9.1");
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
