import { strict as assert } from "node:assert";
import test from "node:test";
import type { DecisionInput } from "@zappy/core";
import { createReadOnlyGovernancePort } from "../src/governance/read-only-governance-port.js";

const baseInput: DecisionInput = {
  tenant: { id: "tenant-1" },
  user: {
    waUserId: "5511999999999@s.whatsapp.net",
    permissionRole: "member",
    relationshipProfile: "member",
    senderIsGroupAdmin: false
  },
  group: {
    waGroupId: "120363426095846827@g.us"
  },
  context: {
    scope: "group",
    isGroup: true,
    routeKey: "messages.upsert"
  },
  request: {
    capability: "command.help"
  },
  runtimePolicySignals: {
    botIsGroupAdmin: false,
    botAdminCheckFailed: true
  }
};

test("read-only governance adapter composes existing policy sources into snapshot", async () => {
  const port = createReadOnlyGovernancePort({
    resolveFlags: async () => ({
      "capability.command.help.enabled": "true",
      "capability.moderation.enabled": "false"
    }),
    readGroup: async () => ({
      tenantId: "tenant-1",
      waGroupId: "120363426095846827@g.us",
      name: "Test Group",
      allowed: true,
      chatMode: "on",
      botIsAdmin: false,
      botAdminCheckedAt: new Date("2026-04-12T00:00:00.000Z")
    }),
    isBotAdmin: async () => true,
    getConsent: async () => ({
      status: "ACCEPTED",
      termsVersion: "2026-03"
    }),
    now: () => new Date("2026-04-12T12:00:00.000Z")
  });

  const snapshot = await port.getSnapshot(baseInput);

  assert.equal(snapshot.tenantId, "tenant-1");
  assert.equal(snapshot.waGroupId, "120363426095846827@g.us");
  assert.equal(snapshot.featureFlags["capability.moderation.enabled"], "false");
  assert.equal(snapshot.group.exists, true);
  assert.equal(snapshot.group.allowed, true);
  assert.equal(snapshot.actor.isBotAdmin, true);
  assert.equal(snapshot.consent.status, "ACCEPTED");
  assert.equal(snapshot.runtimePolicySignals.botAdminCheckFailed, true);
  assert.equal(snapshot.evaluatedAt.toISOString(), "2026-04-12T12:00:00.000Z");
});

test("read-only governance adapter returns unknown consent when no record exists", async () => {
  const port = createReadOnlyGovernancePort({
    resolveFlags: async () => ({}),
    readGroup: async () => null,
    isBotAdmin: async () => false,
    getConsent: async () => null
  });

  const snapshot = await port.getSnapshot({
    ...baseInput,
    context: { scope: "private", isGroup: false },
    group: undefined
  });

  assert.equal(snapshot.scope, "private");
  assert.equal(snapshot.group.exists, false);
  assert.equal(snapshot.consent.status, "UNKNOWN");
});
