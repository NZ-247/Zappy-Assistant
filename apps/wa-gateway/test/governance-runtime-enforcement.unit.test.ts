import { strict as assert } from "node:assert";
import test from "node:test";
import { createGovernanceRuntimeEvaluator } from "../src/inbound/governance-shadow.js";

const createRuntimeEvaluator = (input: {
  status: "PENDING" | "APPROVED" | "BLOCKED";
  tier: "FREE" | "BASIC" | "PRO" | "ROOT";
}) =>
  createGovernanceRuntimeEvaluator({
    enforcementEnabled: true,
    shadowEnabled: false,
    commandPrefix: "/",
    consentTermsVersion: "2026-03",
    withCategory: (_category, payload = {}) => payload,
    logger: {
      info: () => undefined,
      warn: () => undefined
    },
    governancePort: {
      getSnapshot: async () => ({
        evaluatedAt: new Date("2026-04-15T12:00:00.000Z"),
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
            status: input.status,
            tier: input.tier,
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
            status: input.status,
            tier: input.tier
          }
        },
        runtimePolicySignals: {}
      })
    } as any
  });

const baseEvent = {
  tenantId: "tenant-1",
  waUserId: "5511999999999@s.whatsapp.net",
  text: "oi",
  waMessageId: "m-1",
  timestamp: new Date(),
  isGroup: false
} as any;

test("runtime governance allows approved user", async () => {
  const evaluate = createRuntimeEvaluator({ status: "APPROVED", tier: "BASIC" });
  const result = await evaluate({ event: baseEvent, text: "oi", permissionRole: "member", relationshipProfile: "member" });

  assert.equal(result.evaluated, true);
  assert.equal(result.blocked, false);
});

test("runtime governance denies blocked user", async () => {
  const evaluate = createRuntimeEvaluator({ status: "BLOCKED", tier: "FREE" });
  const result = await evaluate({ event: baseEvent, text: "oi", permissionRole: "member", relationshipProfile: "member" });

  assert.equal(result.blocked, true);
  assert.match(String(result.denyText ?? ""), /bloqueado/i);
});

test("runtime governance returns pending approval message", async () => {
  const evaluate = createRuntimeEvaluator({ status: "PENDING", tier: "FREE" });
  const result = await evaluate({ event: baseEvent, text: "oi", permissionRole: "member", relationshipProfile: "member" });

  assert.equal(result.blocked, true);
  assert.match(String(result.denyText ?? ""), /pendente/i);
});
