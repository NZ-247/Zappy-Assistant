# AGENTS.md — Zappy-Assistant (Coding Rules for Agents)

This repository is a monorepo for a scalable WhatsApp assistant.
Agents (Codex) must follow the rules below when generating or editing code.

## 1) Non-negotiable goals
- Keep the architecture Hexagonal / Ports & Adapters:
  - `packages/core` MUST NOT depend on frameworks, DB, Redis, Baileys, or OpenAI SDK.
  - All external integrations live in `packages/adapters` or apps.
- Avoid unstable external dependencies; the only external AI provider is OpenAI (behind a port).
- Admin must be possible without code changes:
  - CRUD triggers and feature flags via Admin API + Admin UI.

## 2) Repo layout (do not change without strong reason)
- `apps/assistant-api`: Fastify Admin API (and optional static hosting for admin-ui)
- `apps/wa-gateway`: Baileys WhatsApp connection + event normalization + message send
- `apps/worker`: BullMQ workers (reminders/jobs)
- `apps/admin-ui`: Static HTML UI that consumes Admin API

- `packages/core`: domain logic (Orchestrator, TriggerEngine, policies, ports/interfaces)
- `packages/adapters`: implementations of ports (Prisma, Redis/BullMQ, OpenAI)
- `packages/shared`: shared types, zod schemas, env loader, logger helpers

- `prisma/`: schema and migrations
- `infra/`: docker-compose and infra files

## 3) TypeScript + quality baseline
- TypeScript strict mode ON.
- Prefer small, readable modules. No “god files”.
- Use explicit types for domain DTOs/events.
- Validate external input (HTTP payloads) with Zod.
- No silent catch: log errors with context.
- Avoid changing working bootstrap plumbing unless necessary.

## 4) Ports and adapters contract
Core defines ports only; adapters implement them.

### Core ports (examples)
- `WhatsAppClientPort`
  - `sendText(to: string, text: string): Promise<void>`
  - `sendTyping(to: string, on: boolean): Promise<void>`
- `LlmPort`
  - `chat(input: { system: string; messages: Array<{role: 'user'|'assistant'|'system'; content: string}> }): Promise<string>`
- `RepositoriesPort` (or split repos)
  - `TriggersRepo`, `FlagsRepo`, `TasksRepo`, `RemindersRepo`, `MessagesRepo`, `AuditRepo`
- `QueuePort`
  - `enqueueReminder(reminderId: string, runAt: Date): Promise<{jobId: string}>`
- `CachePort / RateLimitPort`
  - `get/set`, `incrWithTTL`, etc.

Adapters must live in `packages/adapters/*` and must not leak adapter-specific types into core.
Apps do dependency injection by constructing adapters and passing them into core.

## 5) Message processing pipeline (must follow)
When an inbound WhatsApp message arrives:

1) Normalize into `InboundMessageEvent` (core DTO).
2) Persist inbound message (DB).
3) Run `Orchestrator.handleInboundMessage(event)`:
   a) Resolve feature flags (user > group > tenant > defaults).
   b) TriggerEngine (priority order + cooldown) -> optional reply.
   c) CommandRouter -> tools (/task, /reminder, /help).
   d) LLM fallback if enabled.
4) Send replies via `WhatsAppClientPort`.
5) Persist outbound message (DB).
6) Log actions (pino) and audit changes (Admin side).

Do not shortcut by calling DB/Redis directly from orchestrator.

## 6) Feature flags rules
- Flags exist with scopes: GLOBAL (tenant default), GROUP, USER.
- Precedence: USER > GROUP > GLOBAL > env defaults.
- Default keys to support:
  - `assistant_mode` (off|professional|fun|mixed)
  - `fun_mode` (off|on)
  - `downloads_mode` (off|allowlist|on)

## 7) Triggers rules
- Triggers are data-driven (no code edits required to add behavior).
- Match types supported: CONTAINS, REGEX, STARTS_WITH.
- Evaluate by priority (higher first).
- Cooldown must be enforced using Redis keys (scope-aware).
- Templates support variables:
  - `{{user}}`, `{{group}}`, `{{bot}}`, `{{date}}`
- Triggers must respect feature flags/policies (e.g., fun triggers only when fun_mode enabled).

## 8) Reminders and jobs rules
- Reminders must be scheduled via BullMQ (delayed jobs).
- Worker must be idempotent:
  - check DB status before sending; do not send twice.
- Update reminder status: SCHEDULED -> SENT/FAILED/CANCELED.
- Log job execution with context.

## 9) Admin API & Admin UI rules
- Admin API lives in `apps/assistant-api`.
- All `/admin/*` routes require `Authorization: Bearer <ADMIN_API_TOKEN>`.
- Every mutation (POST/PUT/DELETE) must write an `AuditLog` entry.
- Admin UI is static and must only call Admin API.
- Admin UI should not embed secrets; token can be entered by user and stored in localStorage.

## 10) Data model constraints
- Prisma is the source of truth for DB structure.
- Use migrations for any schema changes.
- Respect existing unique keys:
  - `Group.waGroupId` unique
  - `User.waUserId` unique

## 11) Logging & error handling
- Use pino everywhere (shared logger helper).
- Include correlation/context fields when possible:
  - tenantId, groupId/waGroupId, waUserId, conversationId, messageId
- Errors should be logged once with stack traces.
- Prefer returning safe messages to WhatsApp rather than crashing.

## 12) Dependency rules (hard)
Core must NEVER import:
- fastify, baileys, prisma, ioredis/redis, bullmq, openai SDK, or any Node-only APIs not needed for pure logic.

Apps/adapters may import those, but keep boundaries clean.

## 13) Development workflow
- After changes, ensure:
  - `npm run build` passes
  - (if available) minimal smoke: start assistant-api and hit /health
- Keep changes incremental:
  1) core + ports
  2) adapters
  3) apps integration
  4) UI enhancements

## 14) If you are unsure
- Prefer implementing a small, correct MVP first.
- Do NOT ask questions; choose sensible defaults and proceed.
- Do NOT refactor unrelated code.
