import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createAdminUiApp } from "../public/main.js";

const indexHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf-8");

test("admin-ui renders dashboard and jobs/reminders views with integration fetch data", async () => {
  const dom = new JSDOM(indexHtml, {
    url: "http://localhost:8080"
  });

  const calls: string[] = [];

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push(`${init?.method ?? "GET"} ${path}`);

    if (path.startsWith("/ui-api/admin/v1/status")) {
      return new Response(
        JSON.stringify({
          schemaVersion: "admin.status.v2",
          projectVersion: "1.7.0",
          warnings: ["media-resolver-api is unavailable"],
          services: {
            gateway: { online: true, connected: true, lastHeartbeat: new Date().toISOString() },
            worker: { online: true, lastHeartbeat: new Date().toISOString() },
            adminApi: { online: true, ok: true, lastHeartbeat: new Date().toISOString() },
            mediaResolverApi: { configured: true, online: false, ok: false, status: "unavailable", checkedAt: new Date().toISOString() },
            assistantApi: { configured: false, online: false, ok: false, status: "not_configured", checkedAt: new Date().toISOString() }
          },
          db: { ok: true },
          redis: { ok: true },
          queue: { waiting: 0, active: 0, delayed: 0, failed: 1 },
          reminders: { SCHEDULED: 1, SENT: 0, FAILED: 1, CANCELED: 0 },
          resolver: { health: { configured: true, ok: false, status: "unavailable" } },
          failures: {
            queueFailedJobs: 1,
            failedReminders: 1,
            recentFailedReminders: [
              {
                id: "r-dashboard",
                publicId: "RMD900",
                status: "FAILED",
                message: "Dashboard failed reminder",
                updatedAt: new Date().toISOString()
              }
            ]
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    if (path.startsWith("/ui-api/admin/metrics/summary")) {
      return new Response(JSON.stringify({ commands_executed_total: 15 }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }

    if (path.startsWith("/ui-api/admin/v1/reminders")) {
      return new Response(
        JSON.stringify({
          schemaVersion: "admin.reminders.v1",
          count: 1,
          items: [
            {
              id: "r-900",
              publicId: "RMD900",
              status: "FAILED",
              message: "Retry this reminder",
              waUserId: "u-100",
              remindAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    if (path.startsWith("/ui-api/admin/v1/reminders/r-900/retry") && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          schemaVersion: "admin.reminder.retry.v1",
          item: {
            id: "r-900",
            status: "SCHEDULED"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    if (path.startsWith("/ui-api/admin/v1/governance/bundles") && (init?.method ?? "GET") === "GET") {
      return new Response(
        JSON.stringify({
          schemaVersion: "admin.governance.bundles.v1",
          count: 1,
          items: [
            {
              key: "basic_chat",
              displayName: "Basic Chat",
              description: "Default onboarding bundle",
              active: true,
              capabilities: ["command.ping"],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    if (path.startsWith("/ui-api/admin/v1/governance/capabilities") && (init?.method ?? "GET") === "GET") {
      return new Response(
        JSON.stringify({
          schemaVersion: "admin.governance.capabilities.v1",
          count: 1,
          items: [
            {
              key: "command.ping",
              displayName: "Ping",
              description: "Ping command",
              category: "command",
              bundles: ["basic_chat"],
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    if (path.startsWith("/ui-api/admin/v1/governance/settings")) {
      return new Response(
        JSON.stringify({
          schemaVersion: "admin.governance.settings.v1",
          item: {
            defaults: {
              privateUser: { status: "APPROVED", tier: "FREE", source: "system_default" },
              group: { status: "PENDING", tier: "FREE", source: "system_default" }
            },
            onboarding: {
              privateAssistantEnabled: true,
              serviceExplanationEnabled: true,
              basicQuoteHelpEnabled: true
            },
            governance: {
              separationRule: "private_and_group_defaults_are_independent"
            },
            preSales: {
              readiness: "placeholder_only",
              serviceCatalog: {
                schemaVersion: "services_net.service_catalog.v1",
                source: "manual_placeholder",
                entries: 0
              },
              faq: {
                schemaVersion: "services_net.faq.v1",
                source: "manual_placeholder",
                entries: 0
              }
            }
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: `Unhandled path ${path}` } }), {
      status: 404,
      headers: {
        "content-type": "application/json"
      }
    });
  };

  const app = createAdminUiApp({
    document: dom.window.document,
    fetchImpl,
    storage: dom.window.localStorage,
    uiConfig: {
      defaultAdminApiBaseUrl: "http://localhost:3333",
      uiVersion: "1.7.0"
    }
  });

  await app.init();

  const dashboardText = dom.window.document.getElementById("view-root")?.textContent || "";
  assert.match(dashboardText, /Service Health/i);
  assert.match(dashboardText, /Project Version/i);

  await app.setView("jobs");

  const jobsText = dom.window.document.getElementById("view-root")?.textContent || "";
  assert.match(jobsText, /RMD900/i);
  assert.match(jobsText, /Retry this reminder/i);

  const retryButton = dom.window.document.querySelector('[data-action="reminder-retry"]') as HTMLButtonElement | null;
  assert.ok(retryButton);
  retryButton?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.some((call) => call.includes("POST /ui-api/admin/v1/reminders/r-900/retry")), true);

  await app.setView("bundles");
  const bundlesText = dom.window.document.getElementById("view-root")?.textContent || "";
  assert.match(bundlesText, /Bundle Catalog/i);
  assert.match(bundlesText, /basic_chat/i);

  await app.setView("capabilities");
  const capabilitiesText = dom.window.document.getElementById("view-root")?.textContent || "";
  assert.match(capabilitiesText, /Capability/i);
  assert.match(capabilitiesText, /command\.ping/i);

  await app.setView("settings");
  const settingsText = dom.window.document.getElementById("view-root")?.textContent || "";
  assert.match(settingsText, /New Private User Default/i);
  assert.match(settingsText, /APPROVED/i);
  assert.match(settingsText, /Future Pre-Sales Hook/i);
  assert.match(settingsText, /services_net\.service_catalog\.v1/i);
});
