import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeWhatsAppDirectTarget } from "@zappy/shared";
import { resolveAsyncJobRecipient } from "../src/infrastructure/recipient-resolution.js";

test("resolveAsyncJobRecipient preserves canonical waUserId when it is already a JID", () => {
  const resolution = resolveAsyncJobRecipient({
    waUserId: "70029643092123@lid",
    lidJid: "70029643092123@lid",
    pnJid: "556699064658@s.whatsapp.net",
    phoneNumber: "556699064658"
  });

  assert.equal(resolution.scope, "direct");
  assert.equal(resolution.resolvedRecipient, "70029643092123@lid");
  assert.equal(resolution.recipientSource, "waUserId");
});

test("resolveAsyncJobRecipient avoids raw waUserId fallback when canonical identity JID exists", () => {
  const resolution = resolveAsyncJobRecipient({
    waUserId: "70029643092123",
    lidJid: "70029643092123@lid",
    pnJid: "556699064658@s.whatsapp.net",
    phoneNumber: "556699064658"
  });

  assert.equal(resolution.resolvedRecipient, "70029643092123@lid");
  assert.equal(resolution.recipientSource, "lidJid");
});

test("resolveAsyncJobRecipient follows shared direct-target normalization used by outbound replies", () => {
  const rawTarget = "70029643092123";
  const expected = normalizeWhatsAppDirectTarget(rawTarget);
  assert.equal(expected, "70029643092123@s.whatsapp.net");

  const resolution = resolveAsyncJobRecipient({
    waUserId: rawTarget,
    lidJid: null,
    pnJid: null,
    phoneNumber: null
  });

  assert.equal(resolution.resolvedRecipient, expected);
  assert.equal(resolution.recipientSource, "waUserId");
});
