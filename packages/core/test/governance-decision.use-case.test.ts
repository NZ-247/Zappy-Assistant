import { strict as assert } from "node:assert";
import test from "node:test";
import type { DecisionInput, GovernancePolicySnapshot, GovernancePort } from "../src/modules/governance/index.js";
import { createDefaultCapabilityPolicySnapshot, resolveGovernanceDecision } from "../src/modules/governance/index.js";

type AccessStatus = "PENDING" | "APPROVED" | "BLOCKED" | "UNKNOWN";
type LicenseTier = "FREE" | "BASIC" | "PRO" | "ROOT" | "UNKNOWN";

const baseInput: DecisionInput = {
  tenant: { id: "tenant-1" },
  user: { waUserId: "5511999999999@s.whatsapp.net", permissionRole: "member" },
  context: { scope: "private", isGroup: false, routeKey: "messages.upsert" },
  request: { capability: "conversation.direct" }
};

const createSnapshot = (input: {
  scope: "private" | "group";
  userStatus?: AccessStatus;
  userTier?: LicenseTier;
  groupStatus?: AccessStatus;
  groupTier?: LicenseTier;
  actorPermissionRole?: string;
  actorRole?: "MEMBER" | "ADMIN" | "ROOT";
  actorIsPrivileged?: boolean;
  actorIsBotAdmin?: boolean;
  capabilityPolicy?: GovernancePolicySnapshot["capabilityPolicy"];
  runtimePolicySignals?: Record<string, unknown>;
  groupAllowed?: boolean;
  groupChatMode?: "on" | "off";
}): GovernancePolicySnapshot => {
  const scope = input.scope;
  const userStatus = input.userStatus ?? "APPROVED";
  const userTier = input.userTier ?? "BASIC";
  const groupStatus = input.groupStatus ?? (scope === "group" ? "APPROVED" : "UNKNOWN");
  const groupTier = input.groupTier ?? (scope === "group" ? "FREE" : "UNKNOWN");

  return {
    evaluatedAt: new Date("2026-04-15T00:00:00.000Z"),
    tenantId: "tenant-1",
    waUserId: "5511999999999@s.whatsapp.net",
    waGroupId: scope === "group" ? "120363426095846827@g.us" : undefined,
    scope,
    actor: {
      isBotAdmin: input.actorIsBotAdmin ?? false,
      isPrivileged: input.actorIsPrivileged ?? false,
      permissionRole: input.actorPermissionRole ?? "member",
      relationshipProfile: "member",
      role: input.actorRole
    },
    featureFlags: {},
    group: {
      exists: scope === "group",
      allowed: scope === "group" ? (input.groupAllowed ?? true) : undefined,
      chatMode: scope === "group" ? (input.groupChatMode ?? "on") : undefined,
      botIsAdmin: scope === "group" ? true : undefined
    },
    consent: { exists: true, status: "ACCEPTED", termsVersion: "2026-03" },
    access: {
      user: {
        exists: true,
        status: userStatus,
        tier: userTier,
        approvedBy: userStatus === "APPROVED" ? "ops-admin" : null,
        approvedAt: userStatus === "APPROVED" ? new Date("2026-04-15T00:00:00.000Z") : null,
        source: "persisted"
      },
      group: {
        exists: scope === "group",
        status: groupStatus,
        tier: groupTier,
        approvedBy: groupStatus === "APPROVED" ? "ops-admin" : null,
        approvedAt: groupStatus === "APPROVED" ? new Date("2026-04-15T00:00:00.000Z") : null,
        source: scope === "group" ? "persisted" : "default"
      },
      effective:
        scope === "group"
          ? {
              source: "group",
              status: groupStatus,
              tier: groupTier
            }
          : {
              source: "user",
              status: userStatus,
              tier: userTier
            }
    },
    capabilityPolicy: input.capabilityPolicy ?? createDefaultCapabilityPolicySnapshot(),
    runtimePolicySignals: input.runtimePolicySignals ?? {}
  };
};

const createPort = (input: {
  snapshot: GovernancePolicySnapshot;
  consumeQuota?: GovernancePort["consumeQuota"];
}): GovernancePort => ({
  getSnapshot: async () => input.snapshot,
  consumeQuota: input.consumeQuota
});

test("approved user allowed", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ scope: "private", userStatus: "APPROVED", userTier: "BASIC" })
    }),
    baseInput
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.decision, "allow");
  assert.equal(decision.reasonCodes.includes("ALLOW_POLICY_PASSED"), true);
  assert.equal(decision.approval.state, "approved");
});

test("blocked user in private is denied", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ scope: "private", userStatus: "BLOCKED", userTier: "FREE" })
    }),
    baseInput
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.decision, "deny");
  assert.equal(decision.reasonCodes.includes("DENY_ACCESS_BLOCKED"), true);
  assert.equal(decision.approval.state, "rejected");
});

test("pending user denied with pending approval state", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ scope: "private", userStatus: "PENDING", userTier: "FREE" })
    }),
    baseInput
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.reasonCodes.includes("DENY_ACCESS_PENDING"), true);
  assert.equal(decision.approval.state, "pending");
});

test("FREE user denied premium capability", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ scope: "private", userStatus: "APPROVED", userTier: "FREE" })
    }),
    {
      ...baseInput,
      request: { capability: "command.search_ai" }
    }
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.reasonCodes.includes("DENY_LICENSE_CAPABILITY"), true);
});

test("PRO user allowed premium capability", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ scope: "private", userStatus: "APPROVED", userTier: "PRO" })
    }),
    {
      ...baseInput,
      request: { capability: "command.search_ai" }
    }
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.reasonCodes.includes("DENY_LICENSE_CAPABILITY"), false);
});

test("group PRO + capability + admin requirements allow /hidetag", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({
        scope: "group",
        groupStatus: "APPROVED",
        groupTier: "PRO",
        runtimePolicySignals: {
          botIsGroupAdmin: true
        }
      })
    }),
    {
      ...baseInput,
      user: {
        ...baseInput.user,
        senderIsGroupAdmin: true
      },
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "120363426095846827@g.us" },
      request: {
        capability: "command.hidetag",
        requiredRole: "admin",
        requiresBotAdmin: true
      }
    }
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.snapshot.access.effective.source, "group");
  assert.equal(decision.reasonCodes.includes("DENY_LICENSE_CAPABILITY"), false);
  assert.equal(decision.reasonCodes.includes("DENY_REQUESTER_ROLE"), false);
});

test("blocked group is denied regardless of member state", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({
        scope: "group",
        userStatus: "APPROVED",
        userTier: "PRO",
        groupStatus: "BLOCKED",
        groupTier: "PRO",
        runtimePolicySignals: {
          botIsGroupAdmin: true
        }
      })
    }),
    {
      ...baseInput,
      user: {
        ...baseInput.user,
        senderIsGroupAdmin: true
      },
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "120363426095846827@g.us" },
      request: {
        capability: "command.hidetag",
        requiredRole: "admin",
        requiresBotAdmin: true
      }
    }
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.snapshot.access.effective.source, "group");
  assert.equal(decision.reasonCodes.includes("DENY_ACCESS_BLOCKED"), true);
});

test("bundle grant enables capability when tier default denies", async () => {
  const policy = createDefaultCapabilityPolicySnapshot();
  policy.assignments.user = ["search_tools"];

  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ scope: "private", userStatus: "APPROVED", userTier: "FREE", capabilityPolicy: policy })
    }),
    {
      ...baseInput,
      request: { capability: "command.search_ai" }
    }
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.capabilityPolicy.decisionSource, "bundle");
});

test("group scope ignores user allow override and user bundle grants", async () => {
  const policy = createDefaultCapabilityPolicySnapshot();
  policy.assignments.user = ["moderation_tools"];
  policy.overrides.user["command.hidetag"] = "allow";

  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({
        scope: "group",
        groupStatus: "APPROVED",
        groupTier: "FREE",
        capabilityPolicy: policy
      })
    }),
    {
      ...baseInput,
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "120363426095846827@g.us" },
      request: { capability: "command.hidetag" }
    }
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.capabilityPolicy.explicitAllowSource, null);
  assert.equal(decision.capabilityPolicy.bundleAllowed, false);
});

test("group user explicit deny still blocks as exceptional policy", async () => {
  const policy = createDefaultCapabilityPolicySnapshot();
  policy.assignments.group = ["moderation_tools"];
  policy.overrides.user["command.hidetag"] = "deny";

  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({
        scope: "group",
        groupStatus: "APPROVED",
        groupTier: "PRO",
        capabilityPolicy: policy
      })
    }),
    {
      ...baseInput,
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "120363426095846827@g.us" },
      request: { capability: "command.hidetag" }
    }
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.capabilityPolicy.denySource, "explicit_override_deny");
  assert.equal(decision.capabilityPolicy.explicitDenySources.includes("user_override_deny"), true);
});

test("ADMIN role satisfies admin-gated command requirements", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({
        scope: "group",
        groupStatus: "APPROVED",
        groupTier: "PRO",
        actorPermissionRole: "ADMIN",
        actorRole: "ADMIN",
        runtimePolicySignals: {
          botIsGroupAdmin: true
        }
      })
    }),
    {
      ...baseInput,
      user: {
        ...baseInput.user,
        permissionRole: "ADMIN",
        senderIsGroupAdmin: false
      },
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "120363426095846827@g.us" },
      request: {
        capability: "command.hidetag",
        requiredRole: "admin",
        requiresBotAdmin: true
      }
    }
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.reasonCodes.includes("DENY_REQUESTER_ROLE"), false);
});

test("ROOT role keeps super-admin bypass behavior", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({
        scope: "group",
        groupStatus: "BLOCKED",
        groupTier: "FREE",
        actorPermissionRole: "ROOT",
        actorRole: "ROOT",
        actorIsPrivileged: true,
        groupAllowed: false,
        groupChatMode: "off",
        runtimePolicySignals: {
          botIsGroupAdmin: false
        }
      })
    }),
    {
      ...baseInput,
      user: {
        ...baseInput.user,
        permissionRole: "ROOT"
      },
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "120363426095846827@g.us" },
      request: {
        capability: "command.hidetag",
        requiredRole: "admin",
        requiresBotAdmin: true
      }
    }
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.reasonCodes.includes("ALLOW_ROOT_BYPASS"), true);
});

test("FREE chat limit enforced", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ scope: "private", userStatus: "APPROVED", userTier: "FREE" }),
      consumeQuota: async () => ({
        allowed: false,
        limit: 30,
        used: 31,
        remaining: 0,
        bucket: "conversation.direct.free.daily",
        periodKey: "2026-04-15"
      })
    }),
    baseInput
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.reasonCodes.includes("DENY_QUOTA_LIMIT"), true);
  assert.equal(decision.licensing.quota?.limit, 30);
  assert.equal(decision.licensing.quota?.used, 31);
  assert.equal(decision.licensing.quota?.remaining, 0);
  assert.equal(decision.licensing.quota?.reasonCode, "DENY_QUOTA_LIMIT");
});
