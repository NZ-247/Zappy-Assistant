import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeWhatsAppDirectTarget } from "@zappy/shared";
import { resolveOutboundTarget } from "../src/infrastructure/outbound/target-normalization.js";

test("resolveOutboundTarget normalizes direct numeric IDs with shared WhatsApp addressing rules", () => {
  const raw = "70029643092123";
  const resolution = resolveOutboundTarget(raw);

  assert.equal(resolution.scope, "direct");
  assert.equal(resolution.normalizedTo, normalizeWhatsAppDirectTarget(raw));
  assert.equal(resolution.normalizationApplied, true);
});

test("resolveOutboundTarget keeps canonical direct JIDs stable", () => {
  const canonical = "70029643092123@lid";
  const resolution = resolveOutboundTarget(canonical);

  assert.equal(resolution.scope, "direct");
  assert.equal(resolution.normalizedTo, canonical);
  assert.equal(resolution.normalizationApplied, false);
});

test("resolveOutboundTarget preserves group addressing", () => {
  const groupJid = "120363426095846827@g.us";
  const resolution = resolveOutboundTarget(groupJid);

  assert.equal(resolution.scope, "group");
  assert.equal(resolution.normalizedTo, groupJid);
  assert.equal(resolution.normalizationApplied, false);
});
