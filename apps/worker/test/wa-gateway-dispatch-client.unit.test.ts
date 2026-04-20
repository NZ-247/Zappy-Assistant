import { strict as assert } from "node:assert";
import test from "node:test";
import { createWaGatewayDispatchClient } from "../src/infrastructure/wa-gateway-dispatch-client.js";

const logger = {
  debug: () => undefined,
  warn: () => undefined
};

test("dispatch client requires explicit gateway send confirmation beyond HTTP 200 acceptance", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        dispatchAccepted: true,
        sendStatus: "failed",
        errorCode: "WA_SEND_FAILED",
        errorMessage: "jid_invalid"
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  const client = createWaGatewayDispatchClient({
    baseUrl: "http://localhost:3334",
    token: "token",
    logger
  });

  await assert.rejects(
    () =>
      client.sendText({
        tenantId: "tenant-1",
        to: "70029643092123@lid",
        text: "test",
        action: "send_reminder",
        referenceId: "RMD001"
      }),
    /gateway_send_failed/i
  );
});

test("dispatch client returns confirmation payload when gateway reports sent", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        dispatchAccepted: true,
        sendStatus: "sent",
        waMessageId: "wa-msg-1",
        raw: { provider: "baileys" }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  const client = createWaGatewayDispatchClient({
    baseUrl: "http://localhost:3334",
    token: "token",
    logger
  });

  const sent = await client.sendText({
    tenantId: "tenant-1",
    to: "70029643092123@lid",
    text: "test",
    action: "send_reminder",
    referenceId: "RMD001"
  });

  assert.equal(sent.dispatchAccepted, true);
  assert.equal(sent.sendStatus, "sent");
  assert.equal(sent.waMessageId, "wa-msg-1");
});
