# PM2 Runtime Guide — Zappy Assistant

## Overview

Zappy Assistant supports two process supervision modes:

| Mode | Tool | Best for |
|------|------|----------|
| **Legacy** | `scripts/start.mjs` + tmux | Quick dev sessions, no extra deps |
| **PM2** | `ecosystem.config.cjs` | Persistent dev, prod-like stability |

PM2 is recommended for any environment where the processes must survive after the terminal closes, recover from crashes automatically, or be individually restarted without taking down the whole stack.

---

## Prerequisites

```bash
npm install -g pm2
```

Verify: `pm2 --version`

---

## Quick Start (dev)

```bash
# 1. Check that Redis + Postgres are up
npm run pm2:check-infra

# 2. Start all services with PM2
npm run pm2:start:dev

# 3. Check status
npm run pm2:status

# 4. Tail logs (all services)
npm run pm2:logs

# 5. Stop all
npm run pm2:stop
```

---

## Quick Start (prod)

Build first, then start:

```bash
npm run build
npm run pm2:start:prod
```

For boot persistence after `pm2:start:prod`:

```bash
pm2 save
pm2 startup   # follow the output instruction (one sudo command)
```

---

## Services in PM2

| PM2 name | App | Port (default) | Notes |
|----------|-----|----------------|-------|
| `admin-api` | `@zappy/admin-api` | `ADMIN_API_PORT` (3333) | Canonical local/PM2 control-plane |
| `wa-gateway` | `@zappy/wa-gateway` | `WA_GATEWAY_INTERNAL_PORT` (3334) | WhatsApp session — singleton |
| `worker` | `@zappy/worker` | — | BullMQ consumer |
| `admin-ui` | `@zappy/admin-ui` | `ADMIN_UI_PORT` (8080) | SPA + reverse proxy |
| `media-resolver` | `@zappy/media-resolver-api` | `MEDIA_RESOLVER_API_PORT` (3335) | Download pipeline |

> **assistant-api is NOT in the PM2 config.** It is Docker-only.
> See the [admin-api vs assistant-api](#admin-api-vs-assistant-api) section below.

---

## Common Operations

```bash
# Restart a single service (e.g. after a config change)
pm2 restart admin-api
pm2 restart wa-gateway

# Reload with zero-downtime (for stateless services)
pm2 reload admin-api

# View logs for one service
pm2 logs admin-api
pm2 logs wa-gateway --lines 200

# Interactive monitor (CPU / mem / logs)
npm run pm2:monit

# Save process list (for pm2 startup persistence)
npm run pm2:save
```

---

## Ready Signaling

Each service calls `process.send?.('ready')` after its HTTP server binds (or after the BullMQ worker is ready for the worker process). PM2 uses this signal with `wait_ready: true` to confirm a service actually started before counting the restart attempt.

**When ready fires:**
- `admin-api` / `assistant-api`: after `app.listen()` resolves
- `admin-ui`: after Fastify static server binds
- `media-resolver`: after the HTTP server TCP listen fires
- `worker`: after the BullMQ `Worker` is constructed and heartbeat begins
- `wa-gateway`: after the **internal dispatch API** HTTP server binds (port 3334).
  The WhatsApp connection itself is async and long-running — it is NOT awaited for ready.

The `?.` call operator ensures `process.send('ready')` is a no-op when the process is not managed by PM2 (e.g. `npm run dev`, direct `node dist/index.js`). No code change is required to switch between modes.

---

## Infrastructure Precheck

`scripts/check-infra.mjs` validates prerequisites before PM2 starts:

- Required env vars present (`DATABASE_URL`, `REDIS_URL`, `ADMIN_API_TOKEN`)
- PostgreSQL TCP reachable
- Redis TCP reachable

It is called automatically by `pm2:start:dev` and `pm2:start:prod`. To run manually:

```bash
npm run pm2:check-infra
```

Exit code `0` = all clear. Exit code `1` = fix the reported issues first.

The script loads `.env` and `.env.local` from the project root (same files used by the apps).

---

## Infra: Docker vs native

The check-infra script probes TCP. Whether Redis/Postgres run in Docker or natively is transparent — it only needs the host/port from `REDIS_URL` / `DATABASE_URL` to be reachable.

For Docker-managed infra, start it first:

```bash
docker compose -f infra/docker-compose.yml up postgres redis -d
# Then:
npm run pm2:start:dev
```

---

## admin-api vs assistant-api

These two apps share the same `ADMIN_API_PORT` (default 3333) and **cannot run simultaneously**. They serve different roles:

### `admin-api` — Full control-plane (canonical for local/PM2)

Routes: everything, including:
- `/admin/v1/governance/*` — capability bundles, user/group overrides
- `/admin/v1/users/*`, `/admin/v1/groups/*` — access and license management
- `/admin/v1/licenses/plans`, `/admin/v1/usage/*`
- `/admin/v1/reminders/:id/retry`
- `/admin/v1/audit`

**Used by:** `npm run dev`, `npm run start:dev`, all `pm2:start:*` scripts.

### `assistant-api` — Lightweight runtime API (Docker-only)

Routes: read-oriented subset:
- `/admin/flags`, `/admin/triggers`, `/admin/logs`, `/admin/messages`, `/admin/commands`
- `/admin/queues`, `/admin/metrics/summary`, `/admin/status`
- `/admin/v1/governance/snapshot`

**Used by:** `infra/docker-compose.yml` only.

### Admin UI target

The admin-ui's `/ui-api/*` reverse proxy points to `ADMIN_API_BASE_URL` (defaults to `http://localhost:ADMIN_API_PORT`). It talks to whichever of the two is running on that port. In PM2/dev that's `admin-api`; in Docker that's `assistant-api`.

If you need full governance CRUD from the admin UI in a Docker deployment, change the `assistant-api` service in `docker-compose.yml` to `admin-api`.

---

## traceId — Message Flow Correlation

Every inbound WhatsApp message generates an `executionId` at the WA-IN entry point (`messages-upsert-handler.ts`). This ID flows through:

| Stage | Log category | Field |
|-------|-------------|-------|
| WA inbound entry | `WA-IN` | `executionId` |
| Governance decision | `WA-IN` | `executionId` |
| Core orchestrator | `COMMAND_TRACE` | `executionId` |
| AI generate call | `AI` | `traceId` (same value as `executionId`) |
| WA outbound | `WA-OUT` | `executionId` |

In pretty-log mode, `executionId` and `traceId` appear on every relevant log line. To follow a specific message from ingress to egress:

```bash
# In PM2 logs:
pm2 logs wa-gateway | grep "exec_YOUR_ID"

# In JSON mode (LOG_FORMAT=json):
pm2 logs --raw | jq 'select(.executionId == "exec_...")'
```

The `traceId` field in AI logs has the same value as `executionId` — they are the same ID aliased across the `@zappy/ai` package boundary.

---

## Legacy Runtime (fallback)

The original `scripts/start.mjs` orchestrator remains fully functional:

```bash
npm run start:dev       # legacy dev start (all services)
npm run stop:dev        # legacy stop
npm run restart:dev     # legacy restart
```

Use this as a fallback if PM2 is not installed or if you need the resolver sidecar options (`npm run start:dev:resolvers`).

The two modes are mutually exclusive — don't run PM2 and legacy scripts simultaneously.

---

## Troubleshooting

### Services not marked ready (PM2 `errored`)

PM2 will mark a service as errored if `process.send('ready')` is not received within `listen_timeout` (20s for most services). Causes:
- Service crashed before binding (check `pm2 logs <name>`)
- Port already in use — `lsof -i :<port>` to find the occupier

### Port conflict after crash

If a service crashed without clean shutdown:
```bash
lsof -ti :3333 | xargs kill -9   # admin-api port
pm2 restart admin-api
```

### wa-gateway not connecting to WhatsApp

The `pm2 restart wa-gateway` command triggers a full reconnect. The first restart after a session drop will show the QR/pairing flow in `pm2 logs wa-gateway`. Session files are preserved between restarts at `WA_SESSION_PATH`.
