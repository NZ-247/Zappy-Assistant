import { strict as assert } from "node:assert";
import test from "node:test";
import { createGovernanceShadowEvaluator } from "../src/inbound/governance-shadow.js";

test("governance shadow evaluator logs structured decision in shadow mode", async () => {
  const infoLogs: Array<{ payload: any; message?: string }> = [];
  const warnLogs: Array<{ payload: any; message?: string }> = [];

  const evaluator = createGovernanceShadowEvaluator({
    enabled: true,
    commandPrefix: "/",
    consentTermsVersion: "2026-03",
    governancePort: {
      getSnapshot: async () => ({
        evaluatedAt: new Date("2026-04-12T12:00:00.000Z"),
        tenantId: "tenant-1",
        waUserId: "5511999999999@s.whatsapp.net",
        waGroupId: "120363426095846827@g.us",
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
          chatMode: "on",
          botIsAdmin: false,
          botAdminCheckedAt: new Date("2026-04-12T10:00:00.000Z")
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
            exists: true,
            status: "PENDING",
            tier: "FREE",
            approvedBy: null,
            approvedAt: null,
            source: "persisted"
          },
          effective: {
            source: "group",
            status: "PENDING",
            tier: "FREE"
          }
        },
        runtimePolicySignals: { botIsGroupAdmin: false }
      })
    } as any,
    logger: {
      info: (payload, message) => infoLogs.push({ payload, message }),
      warn: (payload, message) => warnLogs.push({ payload, message })
    },
    withCategory: (category, payload = {}) => ({ category, ...payload })
  });

  await evaluator({
    text: "/hidetag test",
    permissionRole: "member",
    relationshipProfile: "member",
    event: {
      tenantId: "tenant-1",
      waGroupId: "120363426095846827@g.us",
      waUserId: "5511999999999@s.whatsapp.net",
      text: "/hidetag test",
      waMessageId: "m-1",
      timestamp: new Date(),
      isGroup: true,
      botIsGroupAdmin: false
    } as any
  });

  assert.equal(warnLogs.length, 0);
  assert.equal(infoLogs.length, 1);
  assert.equal(infoLogs[0]?.payload?.status, "governance_shadow_decision_evaluated");
  assert.equal(infoLogs[0]?.payload?.shadowMode, true);
  assert.equal(infoLogs[0]?.payload?.decision, "deny");
  assert.equal(infoLogs[0]?.payload?.capability, "command.hidetag");
  assert.equal(Array.isArray(infoLogs[0]?.payload?.reasonCodes), true);
});

test("governance shadow evaluator is no-op when disabled", async () => {
  const infoLogs: unknown[] = [];
  const evaluator = createGovernanceShadowEvaluator({
    enabled: false,
    commandPrefix: "/",
    consentTermsVersion: "2026-03",
    governancePort: {
      getSnapshot: async () => {
        throw new Error("should_not_run");
      }
    } as any,
    logger: {
      info: (payload) => infoLogs.push(payload)
    },
    withCategory: (_category, payload = {}) => payload
  });

  await evaluator({
    text: "/help",
    event: {
      tenantId: "tenant-1",
      waUserId: "u1",
      text: "/help",
      waMessageId: "m-1",
      timestamp: new Date(),
      isGroup: false
    } as any
  });

  assert.equal(infoLogs.length, 0);
});
