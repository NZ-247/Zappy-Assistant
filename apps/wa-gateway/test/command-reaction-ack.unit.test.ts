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

  const pingDecision = resolveCommandProgressAckDecision({
    text: "/ping",
    commandPrefix: "/"
  });
  assert.equal(pingDecision.enabled, false);
  assert.equal(pingDecision.commandName, undefined);
});
