import { strict as assert } from "node:assert";
import test from "node:test";
import { createCommandRegistry } from "../src/commands/registry/index.js";
import { runCommandRouter } from "../src/orchestrator/command-router.js";

test("duplicate command event for same message id is suppressed by command idempotency guard", async () => {
  let timerCreateCalls = 0;
  const idempotencyKeys = new Set<string>();

  const commandRegistry = createCommandRegistry("/");
  const deps: any = {
    ports: {
      cooldown: {
        canFire: async (key: string) => {
          if (idempotencyKeys.has(key)) return false;
          idempotencyKeys.add(key);
          return true;
        }
      },
      timersRepository: {
        createTimer: async () => {
          timerCreateCalls += 1;
          return { id: `timer-${timerCreateCalls}` };
        }
      },
      clock: { now: () => new Date("2026-03-26T12:00:00.000Z") },
      logger: { info: () => {}, warn: () => {} }
    },
    commandPrefix: "/",
    commandRegistry,
    botAdminStaleMs: 180_000,
    botAdminOperationStaleMs: 600_000,
    hasRootPrivilege: () => false,
    isRequesterAdmin: () => false,
    commandRequiresGroupAdmin: () => false,
    stylizeReply: (_ctx: unknown, text: string) => text
  };

  const ctx: any = {
    event: {
      tenantId: "tenant_test",
      waUserId: "556699999999@s.whatsapp.net",
      waMessageId: "wamid.duplicate.1",
      executionId: "exec.duplicate.1",
      normalizedText: "/timer 1m",
      isGroup: false
    },
    now: new Date("2026-03-26T12:00:00.000Z"),
    timezone: "UTC",
    identity: undefined,
    relationshipProfile: "member",
    requesterIsGroupAdmin: false,
    botIsGroupAdmin: true,
    botAdminStatusSource: undefined,
    botAdminSourceUsed: undefined,
    botAdminCheckFailed: false,
    groupAccess: undefined,
    assistantMode: "professional",
    groupChatMode: "on",
    groupAllowed: true,
    groupIsOpen: true
  };

  const firstRun = await runCommandRouter(ctx, deps);
  assert.equal(timerCreateCalls, 1);
  assert.equal(firstRun.some((action) => action.kind === "enqueue_job"), true);

  const secondRun = await runCommandRouter(ctx, deps);
  assert.equal(timerCreateCalls, 1);
  assert.equal(secondRun.length, 1);
  assert.equal(secondRun[0]?.kind, "noop");
  assert.equal((secondRun[0] as { reason?: string }).reason, "command_idempotency_suppressed");
});
