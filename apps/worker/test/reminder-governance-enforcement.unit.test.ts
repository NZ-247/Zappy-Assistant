import { strict as assert } from "node:assert";
import test from "node:test";
import type { GovernancePort } from "@zappy/core";
import { processReminderJob } from "../src/reminders/application/use-cases/process-reminder-job.js";

const createBlockedGovernancePort = (): GovernancePort => ({
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
      exists: false,
      status: "UNKNOWN",
      termsVersion: null
    },
    access: {
      user: {
        exists: true,
        status: "BLOCKED",
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
        status: "BLOCKED",
        tier: "FREE"
      }
    },
    runtimePolicySignals: {}
  })
});

test("worker re-check denies reminder execution when policy changed after scheduling", async () => {
  const statusUpdates: string[] = [];
  let gatewayCalls = 0;
  const errorLogs: unknown[] = [];
  const warnLogs: unknown[] = [];

  const persistence = {
    getReminderDispatchById: async () =>
      ({
        id: "rem-1",
        publicId: "RMD001",
        status: "SCHEDULED",
        tenantId: "tenant-1",
        waUserId: "5511999999999@s.whatsapp.net",
        waGroupId: null,
        message: "Pagar conta",
        user: {
          phoneNumber: null,
          lidJid: null,
          pnJid: null
        },
        userId: "user-1",
        groupId: null
      }) as any,
    updateReminderStatus: async (_id: string, status: any) => {
      statusUpdates.push(String(status));
      return {} as any;
    },
    markReminderMessage: async () => ({} as any),
    persistOutboundMessage: async () => ({} as any)
  };

  await assert.rejects(
    () =>
      processReminderJob("rem-1", {
        governancePort: createBlockedGovernancePort(),
        gatewayClient: {
          sendText: async () => {
            gatewayCalls += 1;
            return { dispatchAccepted: true, sendStatus: "sent", waMessageId: "wa-1" };
          }
        },
        logger: {
          info: () => undefined,
          warn: (payload) => warnLogs.push(payload),
          error: (payload) => errorLogs.push(payload)
        },
        metrics: {
          increment: async () => undefined
        },
        auditTrail: {
          record: async () => undefined
        },
        persistence
      }),
    /worker_governance_execution_denied/i
  );

  assert.equal(gatewayCalls, 0);
  assert.equal(statusUpdates.includes("FAILED"), true);
  assert.equal(warnLogs.length > 0, true);
  assert.equal(errorLogs.length > 0, true);
});
