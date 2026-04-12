import { strict as assert } from "node:assert";
import test from "node:test";
import type { DecisionInput, GovernancePort } from "../src/modules/governance/index.js";
import { resolveGovernanceDecision } from "../src/modules/governance/index.js";

const createPort = (snapshot: Awaited<ReturnType<GovernancePort["getSnapshot"]>>): GovernancePort => ({
  getSnapshot: async () => snapshot
});

const baseInput: DecisionInput = {
  tenant: { id: "tenant-1" },
  user: { waUserId: "5511999999999@s.whatsapp.net", permissionRole: "member" },
  context: { scope: "private", isGroup: false, routeKey: "messages.upsert" },
  request: { capability: "conversation.direct" }
};

test("resolveGovernanceDecision allows when no blocking policy matches", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      evaluatedAt: new Date("2026-04-12T00:00:00.000Z"),
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
      runtimePolicySignals: {}
    }),
    baseInput
  );

  assert.equal(decision.allow, true);
  assert.equal(decision.blockedByPolicy, false);
  assert.equal(decision.reasonCodes.includes("ALLOW_POLICY_PASSED"), true);
});

test("resolveGovernanceDecision denies when group policy blocks the request", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      evaluatedAt: new Date("2026-04-12T00:00:00.000Z"),
      tenantId: "tenant-1",
      waUserId: "5511999999999@s.whatsapp.net",
      waGroupId: "120363@g.us",
      scope: "group",
      actor: {
        isBotAdmin: false,
        isPrivileged: false,
        permissionRole: "member",
        relationshipProfile: "member"
      },
      featureFlags: {},
      group: {
        exists: true,
        allowed: false,
        chatMode: "off",
        botIsAdmin: false
      },
      consent: { exists: true, status: "ACCEPTED", termsVersion: "2026-03" },
      runtimePolicySignals: { botIsGroupAdmin: false }
    }),
    {
      ...baseInput,
      context: { scope: "group", isGroup: true },
      group: { waGroupId: "120363@g.us" },
      request: {
        capability: "command.hidetag",
        commandName: "hidetag",
        requiresBotAdmin: true
      }
    }
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.reasonCodes.includes("DENY_GROUP_NOT_ALLOWED"), true);
  assert.equal(decision.reasonCodes.includes("DENY_GROUP_CHAT_OFF"), true);
  assert.equal(decision.reasonCodes.includes("DENY_BOT_ADMIN_REQUIRED"), true);
});

test("resolveGovernanceDecision denies when consent is pending and not bypassed", async () => {
  const decision = await resolveGovernanceDecision(
    createPort({
      evaluatedAt: new Date("2026-04-12T00:00:00.000Z"),
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
      consent: { exists: true, status: "PENDING", termsVersion: "2026-03" },
      runtimePolicySignals: {}
    }),
    {
      ...baseInput,
      consent: { required: true, status: "PENDING" },
      request: { capability: "tasks" }
    }
  );

  assert.equal(decision.allow, false);
  assert.equal(decision.reasonCodes.includes("DENY_CONSENT_REQUIRED"), true);
});
