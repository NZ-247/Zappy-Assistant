import { strict as assert } from "node:assert";
import test from "node:test";
import type { DecisionInput, GovernancePolicySnapshot, GovernancePort } from "../src/modules/governance/index.js";
import { createDefaultCapabilityPolicySnapshot, resolveGovernanceDecision } from "../src/modules/governance/index.js";

const baseInput: DecisionInput = {
  tenant: { id: "tenant-1" },
  user: { waUserId: "5511999999999@s.whatsapp.net", permissionRole: "member" },
  context: { scope: "private", isGroup: false, routeKey: "messages.upsert" },
  request: { capability: "conversation.direct" }
};

const createSnapshot = (input: {
  status: "PENDING" | "APPROVED" | "BLOCKED";
  tier: "FREE" | "BASIC" | "PRO" | "ROOT";
  capabilityPolicy?: GovernancePolicySnapshot["capabilityPolicy"];
}): GovernancePolicySnapshot => ({
  evaluatedAt: new Date("2026-04-15T00:00:00.000Z"),
  tenantId: "tenant-1",
  waUserId: "5511999999999@s.whatsapp.net",
  scope: "private",
  actor: {
    isBotAdmin: false,
    isPrivileged: false,
    permissionRole: "member",
    relationshipProfile: "member"
  },
  featureFlags: {},
  group: { exists: false },
  consent: { exists: true, status: "ACCEPTED", termsVersion: "2026-03" },
  access: {
    user: {
      exists: true,
      status: input.status,
      tier: input.tier,
      approvedBy: input.status === "APPROVED" ? "ops-admin" : null,
      approvedAt: input.status === "APPROVED" ? new Date("2026-04-15T00:00:00.000Z") : null,
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
      status: input.status,
      tier: input.tier
    }
  },
  capabilityPolicy: input.capabilityPolicy ?? createDefaultCapabilityPolicySnapshot(),
  runtimePolicySignals: {}
});

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
      snapshot: createSnapshot({ status: "APPROVED", tier: "BASIC" })
    }),
    baseInput
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.decision, "allow");
  assert.equal(decision.reasonCodes.includes("ALLOW_POLICY_PASSED"), true);
  assert.equal(decision.approval.state, "approved");
});

test("blocked user denied", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ status: "BLOCKED", tier: "FREE" })
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
      snapshot: createSnapshot({ status: "PENDING", tier: "FREE" })
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
      snapshot: createSnapshot({ status: "APPROVED", tier: "FREE" })
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
      snapshot: createSnapshot({ status: "APPROVED", tier: "PRO" })
    }),
    {
      ...baseInput,
      request: { capability: "command.search_ai" }
    }
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.reasonCodes.includes("DENY_LICENSE_CAPABILITY"), false);
});

test("hidetag capability represented and enforced by tier defaults", async () => {
  const denied = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ status: "APPROVED", tier: "FREE" })
    }),
    {
      ...baseInput,
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "g-1" },
      request: { capability: "command.hidetag", requiresBotAdmin: true }
    }
  );

  assert.equal(denied.allow, false);
  assert.equal(denied.capabilityPolicy.denySource, "tier_default");

  const allowed = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ status: "APPROVED", tier: "PRO" })
    }),
    {
      ...baseInput,
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "g-1" },
      request: { capability: "command.hidetag", requiresBotAdmin: true }
    }
  );

  assert.equal(allowed.allow, false);
  assert.equal(allowed.reasonCodes.includes("DENY_BOT_ADMIN_REQUIRED"), true);
  assert.equal(allowed.reasonCodes.includes("DENY_LICENSE_CAPABILITY"), false);
});

test("bundle grant enables capability when tier default denies", async () => {
  const policy = createDefaultCapabilityPolicySnapshot();
  policy.assignments.user = ["search_tools"];

  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ status: "APPROVED", tier: "FREE", capabilityPolicy: policy })
    }),
    {
      ...baseInput,
      request: { capability: "command.search_ai" }
    }
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.capabilityPolicy.decisionSource, "bundle");
});

test("explicit deny override blocks capability even when bundle allows", async () => {
  const policy = createDefaultCapabilityPolicySnapshot();
  policy.assignments.user = ["moderation_tools"];
  policy.overrides.user["command.hidetag"] = "deny";

  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ status: "APPROVED", tier: "PRO", capabilityPolicy: policy })
    }),
    {
      ...baseInput,
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "g-2" },
      request: { capability: "command.hidetag" }
    }
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.capabilityPolicy.denySource, "explicit_override_deny");
  assert.equal(decision.reasonCodes.includes("DENY_LICENSE_CAPABILITY"), true);
});

test("group context combines user/group overrides with deny-wins", async () => {
  const policy = createDefaultCapabilityPolicySnapshot();
  policy.assignments.group = ["moderation_tools"];
  policy.overrides.user["command.hidetag"] = "allow";
  policy.overrides.group["command.hidetag"] = "deny";

  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ status: "APPROVED", tier: "FREE", capabilityPolicy: policy })
    }),
    {
      ...baseInput,
      context: { scope: "group", isGroup: true, routeKey: "messages.upsert" },
      group: { waGroupId: "g-3" },
      request: { capability: "command.hidetag" }
    }
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.capabilityPolicy.explicitAllowSource, "user_override_allow");
  assert.equal(decision.capabilityPolicy.explicitDenySources.includes("group_override_deny"), true);
});

test("FREE chat limit enforced", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      snapshot: createSnapshot({ status: "APPROVED", tier: "FREE" }),
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
