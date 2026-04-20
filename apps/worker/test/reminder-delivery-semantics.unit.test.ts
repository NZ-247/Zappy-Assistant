import { strict as assert } from "node:assert";
import test from "node:test";
import { processReminderJob } from "../src/reminders/application/use-cases/process-reminder-job.js";

const createReminderRecord = () =>
  ({
    id: "rem-1",
    publicId: "RMD001",
    status: "SCHEDULED",
    tenantId: "tenant-1",
    waUserId: "70029643092123",
    waGroupId: null,
    message: "Pagar conta",
    user: {
      phoneNumber: "556699064658",
      lidJid: "70029643092123@lid",
      pnJid: "556699064658@s.whatsapp.net"
    },
    userId: "user-1",
    groupId: null
  }) as any;

type PersistenceTrackers = {
  statusUpdates: string[];
  markedMessages: Array<{ reminderId: string; messageId?: string }>;
  persistedOutbound: Array<Record<string, unknown>>;
};

const createPersistence = (trackers: PersistenceTrackers) => ({
  getReminderDispatchById: async () => createReminderRecord(),
  updateReminderStatus: async (_id: string, status: any) => {
    trackers.statusUpdates.push(String(status));
    return {} as any;
  },
  markReminderMessage: async (input: { reminderId: string; messageId?: string }) => {
    trackers.markedMessages.push(input);
    return {} as any;
  },
  persistOutboundMessage: async (input: Record<string, unknown>) => {
    trackers.persistedOutbound.push(input);
    return {} as any;
  }
});

const createLogger = () => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
});

test("worker does not mark reminder as delivered on dispatch acceptance without explicit send confirmation", async () => {
  const trackers: PersistenceTrackers = {
    statusUpdates: [],
    markedMessages: [],
    persistedOutbound: []
  };
  const audits: string[] = [];

  await assert.rejects(
    () =>
      processReminderJob("rem-1", {
        logger: createLogger(),
        gatewayClient: {
          sendText: async () =>
            ({
              dispatchAccepted: true,
              sendStatus: "failed",
              waMessageId: "wa-message-1"
            }) as any
        },
        metrics: {
          increment: async () => undefined
        },
        auditTrail: {
          record: async (entry) => {
            audits.push(entry.status);
          }
        },
        persistence: createPersistence(trackers)
      }),
    /gateway_send_unconfirmed/i
  );

  assert.deepEqual(trackers.statusUpdates, ["FAILED"]);
  assert.equal(trackers.markedMessages.length, 0);
  assert.equal(trackers.persistedOutbound.length, 0);
  assert.deepEqual(audits, ["failed"]);
});

test("gateway send success marks reminder as sent and persists canonical outbound waUserId", async () => {
  const trackers: PersistenceTrackers = {
    statusUpdates: [],
    markedMessages: [],
    persistedOutbound: []
  };
  const audits: string[] = [];

  await processReminderJob("rem-1", {
    logger: createLogger(),
    gatewayClient: {
      sendText: async () => ({
        dispatchAccepted: true,
        sendStatus: "sent",
        waMessageId: "wa-message-success",
        raw: { provider: "baileys" }
      })
    },
    metrics: {
      increment: async () => undefined
    },
    auditTrail: {
      record: async (entry) => {
        audits.push(entry.status);
      }
    },
    persistence: createPersistence(trackers)
  });

  assert.deepEqual(trackers.statusUpdates, ["SENT"]);
  assert.equal(trackers.markedMessages.length, 1);
  assert.equal(trackers.markedMessages[0]?.messageId, "wa-message-success");
  assert.equal(trackers.persistedOutbound.length, 1);
  assert.equal(trackers.persistedOutbound[0]?.waUserId, "70029643092123@lid");
  assert.deepEqual(audits, ["sent"]);
});

test("gateway send failure marks reminder as failed and keeps error retryable at queue layer", async () => {
  const trackers: PersistenceTrackers = {
    statusUpdates: [],
    markedMessages: [],
    persistedOutbound: []
  };
  const audits: string[] = [];

  await assert.rejects(
    () =>
      processReminderJob("rem-1", {
        logger: createLogger(),
        gatewayClient: {
          sendText: async () => {
            throw new Error("gateway_send_failed:WA_SEND_FAILED");
          }
        },
        metrics: {
          increment: async () => undefined
        },
        auditTrail: {
          record: async (entry) => {
            audits.push(entry.status);
          }
        },
        persistence: createPersistence(trackers)
      }),
    /gateway_send_failed/i
  );

  assert.deepEqual(trackers.statusUpdates, ["FAILED"]);
  assert.equal(trackers.markedMessages.length, 0);
  assert.equal(trackers.persistedOutbound.length, 0);
  assert.deepEqual(audits, ["failed"]);
});
