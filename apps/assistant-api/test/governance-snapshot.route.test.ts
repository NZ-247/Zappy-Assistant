import { strict as assert } from "node:assert";
import test from "node:test";
import Fastify from "fastify";
import { registerAssistantApiRoutes } from "../src/http/routes.js";

const buildRuntime = () =>
  ({
    env: {
      ADMIN_API_TOKEN: "test-token",
      LLM_ENABLED: true,
      OPENAI_API_KEY: "test"
    },
    governancePort: {
      getSnapshot: async (input: any) => ({
        evaluatedAt: new Date("2026-04-12T10:00:00.000Z"),
        tenantId: input.tenant.id,
        waUserId: input.user.waUserId,
        waGroupId: input.group?.waGroupId,
        scope: input.context.scope,
        actor: {
          isBotAdmin: false,
          isPrivileged: false,
          permissionRole: input.user.permissionRole ?? null,
          relationshipProfile: input.user.relationshipProfile ?? null
        },
        featureFlags: {},
        group: {
          exists: Boolean(input.group),
          allowed: true,
          chatMode: "on",
          botIsAdmin: true,
          botAdminCheckedAt: new Date("2026-04-12T09:00:00.000Z")
        },
        consent: {
          exists: true,
          status: "ACCEPTED",
          termsVersion: "2026-03"
        },
        access: {
          user: {
            exists: true,
            status: "PENDING",
            tier: "FREE",
            approvedBy: null,
            approvedAt: null,
            source: "persisted"
          },
          group: {
            exists: Boolean(input.group),
            status: input.group ? "PENDING" : "UNKNOWN",
            tier: input.group ? "FREE" : "UNKNOWN",
            approvedBy: null,
            approvedAt: null,
            source: input.group ? "persisted" : "default"
          },
          effective: input.group
            ? {
                source: "group",
                status: "PENDING",
                tier: "FREE"
              }
            : {
                source: "user",
                status: "PENDING",
                tier: "FREE"
              }
        },
        runtimePolicySignals: input.runtimePolicySignals ?? {}
      })
    },
    queue: {
      name: "reminders",
      getJobCounts: async () => ({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })
    },
    metrics: {
      getSnapshot: async () => ({})
    },
    redis: {}
  }) as any;

test("GET /admin/v1/governance/snapshot returns evaluated decision payload", async () => {
  const app = Fastify();
  registerAssistantApiRoutes(app as any, buildRuntime());

  const response = await app.inject({
    method: "GET",
    url: "/admin/v1/governance/snapshot?tenantId=t1&waUserId=u1&scope=private&capability=conversation.direct",
    headers: {
      authorization: "Bearer test-token"
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.schemaVersion, "governance.snapshot.v1");
  assert.equal(payload.shadowMode, true);
  assert.equal(payload.input.tenant.id, "t1");
  assert.equal(typeof payload.decision.allow, "boolean");

  await app.close();
});

test("GET /admin/v1/governance/snapshot validates required query params", async () => {
  const app = Fastify();
  registerAssistantApiRoutes(app as any, buildRuntime());

  const response = await app.inject({
    method: "GET",
    url: "/admin/v1/governance/snapshot?tenantId=t1",
    headers: {
      authorization: "Bearer test-token"
    }
  });

  assert.equal(response.statusCode, 400);
  const payload = response.json();
  assert.equal(payload.error, "Missing required query params: tenantId, waUserId");

  await app.close();
});
