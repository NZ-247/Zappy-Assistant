import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveCommandProgressAckDecision } from "../src/infrastructure/command-reaction-ack.js";

test("ack decision enables progress for long-running commands", () => {
  const imgDecision = resolveCommandProgressAckDecision({
    text: "/img Porsche 911 GT3RS",
    commandPrefix: "/"
  });
  assert.equal(imgDecision.enabled, true);
  assert.equal(imgDecision.commandName, "img");

  const searchDecision = resolveCommandProgressAckDecision({
    text: ".search arquitetura hexagonal",
    commandPrefix: "."
  });
  assert.equal(searchDecision.enabled, true);
  assert.equal(searchDecision.commandName, "search");
});

test("ack decision resolves aliases and skips non-latency commands", () => {
  const aliasDecision = resolveCommandProgressAckDecision({
    text: "/sai impacto da IA em 2026",
    commandPrefix: "/"
  });
  assert.equal(aliasDecision.enabled, true);
  assert.equal(aliasDecision.commandName, "search-ai");

  const tssAliasDecision = resolveCommandProgressAckDecision({
    text: "/tss",
    commandPrefix: "/"
  });
  assert.equal(tssAliasDecision.enabled, true);
  assert.equal(tssAliasDecision.commandName, "transcribe");

  const trlDecision = resolveCommandProgressAckDecision({
    text: "/trl bonjour",
    commandPrefix: "/"
  });
  assert.equal(trlDecision.enabled, true);
  assert.equal(trlDecision.commandName, "trl");

  const dlDecision = resolveCommandProgressAckDecision({
    text: "/dl https://www.instagram.com/reel/abc123/",
    commandPrefix: "/"
  });
  assert.equal(dlDecision.enabled, true);
  assert.equal(dlDecision.commandName, "dl");

  const pingDecision = resolveCommandProgressAckDecision({
    text: "/ping",
    commandPrefix: "/"
  });
  assert.equal(pingDecision.enabled, false);
  assert.equal(pingDecision.commandName, undefined);
});
