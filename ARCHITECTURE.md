# ARCHITECTURE.md — Zappy-Assistant

Zappy-Assistant is a scalable WhatsApp assistant focused on atendimento, agendamentos, lembretes e gestão de tarefas, com modos (professional/fun) controlados por feature flags. The system is designed with **Hexagonal Architecture (Ports & Adapters)** to keep the domain stable and allow swapping integrations (Baileys, DB, LLM, queues) without rewriting business logic.

---

## 1) High-level overview

### Core principles
- **Core domain is pure**: `packages/core` must not import Baileys, Fastify, Prisma, Redis, BullMQ, OpenAI SDK.
- **Everything external is an adapter**: DB, Redis, Queue, WhatsApp, LLM.
- **Event-driven internally**: incoming messages trigger a deterministic pipeline and may produce background jobs (reminders).

### Monorepo layout
- `apps/wa-gateway`  
  WhatsApp connection (Baileys), event normalization, calls core orchestrator, sends replies.
- `apps/assistant-api`  
  Admin API (CRUD triggers/flags/logs/status) protected by token.
- `apps/worker`  
  BullMQ workers: executes reminders/jobs; updates DB; sends WhatsApp messages.
- `apps/admin-ui`  
  Static UI for Admin API (flags/triggers/logs/status).

- `packages/core`  
  Orchestrator, TriggerEngine, CommandRouter, policies, ports (interfaces).
- `packages/adapters`  
  Implementations: Prisma repositories, Redis helpers, BullMQ queue, OpenAI adapter.
- `packages/shared`  
  Common types, Zod schemas, env loader, logger helpers.

---

## 2) Message pipeline (end-to-end)

### 2.1 Inbound: WhatsApp → Orchestrator
1) **Receive event** (Baileys)  
   `messages.upsert` / `connection.update` etc.

2) **Normalize event** (wa-gateway)  
   Convert Baileys message into a core DTO:
   - `InboundMessageEvent`
     - `tenantId`
     - `waGroupId?`
     - `waUserId`
     - `text`
     - `waMessageId`
     - `timestamp`
     - `isGroup`

3) **Resolve tenant/group/user** (wa-gateway + repositories)
   Mapping strategy (MVP):
   - If `ONLY_GROUP_ID` is set: treat that group as allowed scope / default tenant.
   - Else: auto-create a default Tenant and register new groups/users on first message.

4) **Persist inbound message** (DB)
   Create Message row with direction `IN`, plus `rawJson` for audit/debug.

5) **Call core**  
   `Orchestrator.handleInboundMessage(event)` returns an action:
   - `ReplyAction(text)`
   - `EnqueueReminderAction(reminderId, runAt)`
   - `Noop`

6) **Execute action**
   - If reply: send text via WhatsApp adapter and persist outbound message.
   - If enqueue: store reminder in DB and enqueue BullMQ delayed job.
   - If noop: do nothing.

7) **Persist outbound message** (DB)  
   direction `OUT`, store `rawJson` if available.

---

### 2.2 Core inbound execution stages (normalized pipeline)
Every inbound message now runs through explicit, small stages inside core:

1. normalize event  
2. authenticate / identify sender  
3. resolve tenant / group / user  
4. resolve roles and permissions  
5. resolve flags / settings / modules  
6. classify message (system | ignored | command | trigger candidate | AI candidate | tool follow-up)  
7. apply mute / handoff policies  
8. trigger engine  
9. command router  
10. AI fallback  
11. response formatting (ReplyText / ReplyList → text)  
12. persistence / logging (performed in adapters/apps)

Pipeline sketch:
```
incoming WA event
  ↓ (status/broadcast + media guard)
normalize → identify → scope → permissions → flags → classify
          → mute/handoff → trigger → command → AI fallback
          → format responses → persist/log
```

Classification & protections:
- Status/broadcast (`status@broadcast`), bot-echo, duplicate messages, and media-only events (when downloads are off) are ignored safely.
- Conversation state (`NONE | WAITING_CONFIRMATION | WAITING_TASK_DETAILS | WAITING_REMINDER_DETAILS | HANDOFF_ACTIVE`) is loaded via a port to support multi-step flows.

Response actions (normalized contract):
- `ReplyTextAction`, `ReplyListAction` (formatted to text), `EnqueueJobAction` (reminder/timer), `NoopAction`, `ErrorAction` (becomes text), `HandoffAction`.

---

## 3) Orchestrator flow (decision order)

Orchestrator is the central decision-maker. It must remain deterministic and side-effect free except through ports.

### Decision order (MVP)
**1) Feature flags + policies**
- Resolve flags for the sender scope:
  Precedence: `USER > GROUP > GLOBAL(tenant) > env defaults`
- Key flags (recommended):
  - `assistant_mode`: `off|professional|fun|mixed`
  - `fun_mode`: `off|on`
  - `downloads_mode`: `off|allowlist|on`

**2) Trigger Engine (data-driven)**
- Fetch triggers for scope (user/group/global), sorted by priority descending.
- Evaluate match:
  - `CONTAINS`
  - `REGEX`
  - `STARTS_WITH`
- If matched and not in cooldown:
  - Render template
  - Return `ReplyAction`

**3) Command Router (/help, /task, /reminder)**
- Parse user message as command if it starts with `/`.
- Dispatch to tool handlers backed by repositories (tasks/reminders) and queue.

**4) LLM fallback**
- Only if assistant mode enables it.
- Uses OpenAI adapter behind `LlmPort`.
- Sends system prompt + recent context messages from DB.
- Returns `ReplyAction` with model output.

If none applies, return `Noop`.

---

## 4) Trigger system (Admin-configurable)

Triggers are designed to allow “atendimento” and automations without code changes.

### Trigger model (concept)
- `scope`: `GLOBAL | GROUP | USER`
- `matchType`: `CONTAINS | REGEX | STARTS_WITH`
- `pattern`: string
- `responseTemplate`: string (supports variables)
- `priority`: integer (higher first)
- `cooldownSeconds`: integer (rate control)
- `enabled`: boolean

### Cooldown enforcement
Cooldown is enforced via Redis:
- Key should include: `tenantId`, `scope`, `targetId`, `triggerId`
- TTL = `cooldownSeconds`
If key exists → ignore trigger match.

### Template rendering
Supported variables (MVP):
- `{{user}}` → user id or name if available
- `{{group}}` → group name/id if available
- `{{bot}}` → bot name
- `{{date}}` → formatted date/time

---

## 5) Commands: /task and /reminder

Commands are the “tool layer” accessible from chat.

### 5.1 /task
Recommended commands (MVP):
- `/task add <title>`
  - creates a task in DB (OPEN)
- `/task list`
  - lists recent OPEN tasks for scope (group or user)
- `/task done <id>`
  - marks as DONE (id must exist in tenant scope)

Recommended behavior:
- If in group: tasks default to group scope.
- If in DM: tasks default to user scope.

### 5.2 /reminder
Recommended commands (MVP):
- `/reminder in <minutes> <message>`
  - creates reminder row + enqueues delayed job (now + minutes)
- `/reminder at <YYYY-MM-DD HH:MM> <message>`
  - creates reminder row + enqueues delayed job for that time

Reminders should be stored in DB with:
- `remindAt`
- `status`: `SCHEDULED|SENT|FAILED|CANCELED`
- `jobId` when queued

---

## 6) LLM integration (OpenAI)

LLM lives behind `LlmPort` and must be fully swappable.

### Core contract
Core sends:
- `system` prompt (from DB or defaults)
- `messages` context (recent user+assistant turns)

Adapter responsibilities:
- call OpenAI API
- handle errors and timeouts
- return text response

### Prompts (recommended)
- Tenant-level default system prompt stored as a flag (e.g. key `system_prompt`) or a dedicated table.
- Group override allowed (for company-specific style).

### Operational guidance
- Apply rate limit per user/group/tenant in Redis.
- Add a circuit-breaker behavior:
  - If LLM fails: reply with a safe fallback (“Posso ajudar com /task e /reminder…”)
- Short-term AI memory is stored separately from raw Message logs in `ConversationMemory` (trimmed turns only). Default window: `LLM_MEMORY_MESSAGES=10`; older entries are pruned after each append.
- AI assistant can return text or a tool suggestion (create/list task, create/list reminder, add/list note, get_time, get_settings); orchestrator decides execution vs reply.

---

## 7) Worker & jobs (BullMQ)

BullMQ is the backbone for background work and scheduled tasks.

### Reminder job lifecycle
1) Orchestrator returns `EnqueueReminderAction`
2) Gateway/API:
   - Persist reminder row as `SCHEDULED`
   - Enqueue delayed job with payload `{ reminderId }`
3) Worker processes job:
   - Load reminder by id
   - If status != SCHEDULED → stop (idempotency)
   - Send WhatsApp message
   - Update status to SENT (or FAILED)
   - Optionally log audit entry or job log

### Idempotency rules
- Worker must never send twice:
  - check DB status before sending
- Jobs may retry; DB check prevents duplicates.

### Future jobs
- Daily summaries (repeatable job)
- Cleanup tasks
- Reprocessing failed messages
- Appointment follow-ups

---

## 8) Admin API / Admin UI

### Admin API
- All `/admin/*` routes require:
  `Authorization: Bearer <ADMIN_API_TOKEN>`
- Public:
  - `GET /health` should return ok + DB/Redis check
- Admin:
  - CRUD `/admin/flags`
  - CRUD `/admin/triggers`
  - `/admin/logs?limit=...`
  - `/admin/status` (recommended: gateway heartbeat + queue stats)
  - `/admin/messages?limit=...` (monitoring)

### Audit logging
Every mutation (POST/PUT/DELETE) writes `AuditLog`:
- actor (admin identifier)
- action
- entity + entityId
- beforeJson/afterJson

### Admin UI
Static UI is intentionally minimal:
- Flags page: create/update/delete flags by scope
- Triggers page: create/update/delete triggers
- Logs page: view audit logs
- Status page (optional): gateway + queue + latest messages

Token handling:
- token entered by user and stored in localStorage
- no token baked into HTML

---

## 9) Scalability model (how it grows)

### Phase 1 — Single host (now)
All services in one machine, via Docker Compose:
- postgres
- redis
- assistant-api
- wa-gateway
- worker
- admin-ui

### Phase 2 — Separate processes / containers
- Move worker to a separate container (increase workers)
- Keep wa-gateway isolated (restarts should not affect worker/API)
- Add reverse proxy for admin endpoints

### Phase 3 — Multi-instance
- Multiple workers are safe (BullMQ handles concurrency)
- Multiple gateways are tricky (WhatsApp session): keep a single gateway per WA account, or shard by account.
- DB remains single (or managed Postgres).
- Redis should be stable, preferably managed.

### Phase 4 — Swap WhatsApp provider (optional)
Because core does not depend on Baileys, you can replace the gateway:
- Baileys → WhatsApp Cloud API adapter
without rewriting orchestrator.

---

## 10) How to run & test locally (developer workflow)

### Prerequisites
- Node.js 20+
- Docker + Docker Compose
- PostgreSQL and Redis (or docker services)

### Setup
1) Copy env template:
   - `cp .env.example .env`

2) Start infra:
   - `docker compose -f infra/docker-compose.yml up -d postgres redis`

3) Install deps:
   - `npm install`

4) Prisma:
   - `npm run prisma:generate`
   - `npm run prisma:migrate`

### Start services (local)
- Option A: run everything:
  - `npm run dev`

- Option B: run individually:
  - `npm -w apps/assistant-api run dev`
  - `npm -w apps/wa-gateway run dev`
  - `npm -w apps/worker run dev`
  - `npm -w apps/admin-ui run dev` (if it has a dev server)

### Verify health
- `GET http://localhost:3333/health`

### WhatsApp pairing & smoke test
- Run `wa-gateway` and complete pairing code flow in terminal.
- Send a message to the bot number.
- Confirm:
  - inbound message is stored in DB
  - bot replies to `/help`
  - `/task add teste`
  - `/reminder in 1 teste`
  - worker sends reminder after 1 minute

---

## 11) Recommended next steps (after MVP build passes)

1) Add `/admin/status` + gateway heartbeat in Redis (every 10s).
2) Improve tenant/group mapping in Admin (explicit registration).
3) Add tests:
   - unit tests for TriggerEngine and FeatureFlagResolver
   - integration tests for Admin API routes
4) Improve LLM behavior:
   - system prompt storage per group
   - context window config
   - safe fallback behavior
5) Add appointment scheduling domain (slots + confirmations).

---

## 12) Notes about local typings
This repo may include local ambient typings for constrained environments (e.g. Codex sandbox).
On real development machines, prefer official dependencies/types:
- Baileys deps should install normally
- `@hapi/boom` should install normally

If you replace ambient typings with real packages, ensure build still passes.
