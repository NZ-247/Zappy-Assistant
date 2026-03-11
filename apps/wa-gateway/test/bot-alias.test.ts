import { strict as assert } from "node:assert";
import test from "node:test";
import { buildBotAliases, jidMatchesBot, normalizeJid, normalizeLidJid, stripUser } from "../src/bot-alias.js";

test("normalizeJid trims device suffix and normalizes c.us", () => {
  assert.equal(normalizeJid("556692207782:10@s.whatsapp.net"), "556692207782@s.whatsapp.net");
  assert.equal(normalizeJid("556692207782@c.us"), "556692207782@s.whatsapp.net");
});

test("normalizeLidJid returns only lid identifiers", () => {
  assert.equal(normalizeLidJid("144251207811240@lid"), "144251207811240@lid");
  assert.equal(normalizeLidJid("556692207782@s.whatsapp.net"), null);
});

test("buildBotAliases includes pn and lid variants plus stripped forms", () => {
  const aliases = buildBotAliases({ pnJid: "556692207782:10@s.whatsapp.net", lidJid: "144251207811240@lid" });
  assert.ok(aliases.includes("556692207782:10@s.whatsapp.net"));
  assert.ok(aliases.includes("556692207782@s.whatsapp.net"));
  assert.ok(aliases.includes("556692207782"));
  assert.ok(aliases.includes("144251207811240@lid"));
  assert.ok(aliases.includes("144251207811240"));
});

test("jidMatchesBot matches both pn and lid aliases safely", () => {
  const aliases = buildBotAliases({ pnJid: "556692207782:10@s.whatsapp.net", lidJid: "144251207811240@lid" });
  const pnMatch = aliases.some((alias) => jidMatchesBot("556692207782@s.whatsapp.net", alias));
  const lidMatch = aliases.some((alias) => jidMatchesBot("144251207811240@lid", alias));
  const wrong = aliases.some((alias) => jidMatchesBot("999999999999@lid", alias));
  assert.equal(pnMatch, true);
  assert.equal(lidMatch, true);
  assert.equal(wrong, false);
});

test("stripUser works for pn and lid forms", () => {
  assert.equal(stripUser("556692207782:10@s.whatsapp.net"), "556692207782");
  assert.equal(stripUser("144251207811240@lid"), "144251207811240");
});
