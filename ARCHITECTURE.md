---

# `ARCHITECTURE.md`

```md
# ARCHITECTURE.md

# Zappy Assistant — Architecture

## 1. Architectural style

Zappy Assistant is a **modular monolith** implemented as a monorepo with multiple runtime apps.

The target architecture is:

- **Modular Monolith**
- **Hexagonal Architecture / Ports and Adapters**
- **Use Cases per Module**
- **Transport-agnostic Core**
- **Single deployable codebase with multiple processes**

This architecture was chosen because it gives:
- lower operational complexity than microservices
- strong internal modularity
- easier testing and maintenance
- easier future expansion to new platforms and APIs

---

## 2. High-level runtime topology

## 2.1 Runtime apps

### `apps/wa-gateway`
Responsibilities:
- connect to WhatsApp via Baileys
- normalize inbound WhatsApp messages into internal message DTOs
- detect mentions/replies/group metadata
- execute platform actions:
  - send replies
  - group admin actions
  - moderation actions
  - media updates
- expose authenticated internal dispatch endpoint for async worker deliveries
- write gateway heartbeat
- collect platform-level observability

### `apps/assistant-api`
Responsibilities:
- expose Admin API endpoints
- status/health
- queues
- metrics
- commands/messages feeds
- administrative read/write endpoints over time
- validate `ADMIN_API_TOKEN`

### `apps/worker`
Responsibilities:
- consume BullMQ jobs
- reminders
- delayed/background actions
- dispatch async outbound texts through wa-gateway internal API (never directly to Baileys)
- write worker heartbeat
- increment metrics / audit background actions

### `apps/admin-ui`
Responsibilities:
- consume Admin API only
- show operational status, queues, metrics, messages, commands
- provide simple admin workflows over documented contracts

---

## 2.2 Shared packages

### `packages/core`
Application pipeline and dispatch layer.

Long-term role:
- ingress processing pipeline
- context resolution orchestration
- module dispatch
- normalized outbound action generation

It should **not** remain the permanent home for all business logic.

### `packages/ai`
Responsibilities:
- persona definitions
- prompt building
- tool-intent support
- AI memory orchestration
- AI assistant response generation

### `packages/adapters`
Responsibilities:
- Prisma repository implementations
- Redis implementations
- BullMQ implementations
- OpenAI implementation
- audit and metrics persistence
- platform helper adapters

### `packages/shared`
Responsibilities:
- env loading
- logger
- shared types/constants/utilities

---

## 3. Core application flow

The logical inbound pipeline is:

1. **Ingress normalization**
   - WhatsApp/Baileys message -> internal `InboundMessage`

2. **Identity and context resolution**
   - canonical identity
   - relationship profile
   - role/permissions
   - tenant/group context

3. **Consent and access checks**
   - direct-chat consent gate
   - allowed group checks
   - chat on/off rules
   - mention/reply addressed checks

4. **Intent classification**
   - prefix command
   - trigger
   - addressed AI
   - ignored chatter
   - system/moderation event

5. **Module dispatch**
   - route to the proper module / use case

6. **Use-case execution**
   - business rules
   - repositories
   - platform ports
   - queue ports
   - audit/metrics

7. **Outbound action normalization**
   - `reply_text`
   - `reply_list`
   - `group_admin_action`
   - `moderation_action`
   - `enqueue_job`
   - `hidetag`
   - `noop`

8. **Platform rendering**
   - wa-gateway translates outbound action into Baileys/platform calls

9. **Observability**
   - audit logs
   - metrics
   - heartbeats
   - status endpoints

---

## 4. Domain modules (target structure)

Zappy should be organized by business capability modules.

## 4.1 Identity
Responsibilities:
- canonical user identity
- PN/LID alias mapping
- relationship profiles
- role inference
- bot self alias resolution

## 4.2 Consent
Responsibilities:
- onboarding
- terms acceptance / decline
- bypass policies for privileged identities

## 4.3 Groups
Responsibilities:
- allowed groups
- chat mode
- group settings
- group info
- group open/close
- welcome/rules/fixed messages

## 4.4 Tasks
Responsibilities:
- create/list/update/complete/remove tasks
- group/direct scoping where applicable

## 4.5 Reminders
Responsibilities:
- create/list/cancel reminders
- scheduling through queue
- slot-filling where needed

## 4.6 Notes
Responsibilities:
- group/direct notes
- list/add/remove

## 4.7 Moderation
Responsibilities:
- mute/unmute
- ban/kick
- hidetag
- anti-link
- temporary moderation states

## 4.8 Assistant AI
Responsibilities:
- addressed conversational behavior
- persona
- tool-intent recognition
- slot-filling support
- structured fallback

## 4.9 Admin
Responsibilities:
- status
- commands/messages feeds
- settings exposure
- operational APIs

## 4.10 Observability
Responsibilities:
- heartbeats
- metrics
- command audit
- moderation audit
- queue visibility

## 4.11 Media / Fun (future)
Responsibilities:
- stickers
- TTS
- search
- image search
- downloads
- fun mode capabilities

---

## 5. Recommended internal module structure

Target structure inside `packages/core/src/modules/<module-name>/`:

```text
modules/
  reminders/
    application/
      use-cases/
      dto/
      policies/
    domain/
    infrastructure/
    ports/
    ports.ts
    presentation/
      commands/
    index.ts
```

Layer meaning
application/use-cases

Business workflows:

create reminder

mute user

set group name

list notes

domain

Core rules/entities/value objects if needed.

ports

Interfaces the module depends on:

repositories

queue

metrics

audit

platform ports

presentation/commands

Command parsing and mapping to use cases.

6. Command system architecture

Zappy must move toward a central Command Registry.

Each command should define:

name

aliases

scope

requiredRole

botAdminRequired

description

usage

examples

bound use case or handler

Prefix

Prefix is globally configurable through:

BOT_PREFIX=/

Rules:

parser must respect active prefix

help output must use active prefix

commands must not hardcode /

Implementation status:

- The command registry, parser, and prefix helpers live in `packages/core/src/commands/registry/*` and `packages/core/src/commands/parser/*` (`command-groups.ts`, `index.ts`, `parse-command.ts`, `prefix.ts`, `utils.ts`). Registry metadata covers name/aliases/scope/role/botAdminRequired/description/usage and lookup honors the active prefix.
- Command parsing in `Orchestrator` now goes through the shared parser/registry instead of inline string checks.
- First moduleized command handlers exist under `packages/core/src/modules/` for `groups`, `moderation`, and `reminders` (presentation/commands/*), keeping feature logic out of the core entrypoint.

Help generation

/help should become registry-driven.

7. Platform and transport boundaries

The core must remain transport-agnostic.

WhatsApp-specific concerns belong in gateway/adapters

Examples:

Baileys message shape

mentionedJid parsing

quoted participant parsing

LID/PN specifics

group invite code / metadata probing

profile picture update mechanics

Core only sees normalized concepts

Examples:

isBotMentioned

isReplyToBot

groupId

senderId

commandName

outboundAction

8. Ports and adapters
8.1 Core-side ports

Typical ports include:

LlmPort

QueuePort

AuditPort

MetricsPort

TaskRepositoryPort

ReminderRepositoryPort

GroupRepositoryPort

ConsentRepositoryPort

GroupPlatformPort

MessagePlatformPort

8.2 Adapter implementations

Typical adapters include:

Prisma repositories

Redis metrics/state

BullMQ queue adapter

OpenAI adapter

Baileys/WhatsApp action adapter

9. Operation-first group admin strategy

In WhatsApp groups, metadata-based admin detection may be unreliable because of PN/LID differences.

Therefore:

requester authorization is checked independently

bot-admin is treated operationally

commands that require bot admin use operation-first behavior:

attempt platform action

if success -> confirmed

if failure by permission -> user-friendly error

metadata serves as informational status, not the main gate

This reduces false negatives and keeps behavior closer to real platform capability.

10. Observability architecture
10.1 Heartbeats

gateway heartbeat in Redis

worker heartbeat in Redis

10.2 Status

Admin API exposes:

service status

bot connection state

DB/Redis status

queue state

LLM enabled/disabled

10.3 Metrics

Redis-backed counters for:

messages received

commands executed

triggers matched

AI requests/failures

reminders created/sent

moderation actions

onboarding states

10.4 Audit

Structured command/action audit through persistence (CommandLog and related events).

11. Admin API / Admin UI contract model

Admin UI must consume Admin API only.

Examples of API domains:

/admin/status

/admin/queues

/admin/metrics/summary

/admin/commands

/admin/messages

Payload contracts are documented separately in INTEGRATION_CONTRACTS.md.

12. External integrations

Current external integrations:

WhatsApp via Baileys

OpenAI

PostgreSQL via Prisma

Redis

BullMQ

Future integrations may include:

other chat platforms

web chat

email

CRM / ERP / finance systems

document/file backends such as Nextcloud

Rule

New integrations must enter via ports/adapters, not directly into core use cases.

13. Current pain points and refactor intent

The current codebase still concentrates too much logic in packages/core/src/index.ts.

This is acceptable for a transitional phase, but not for long-term growth.

Refactor goals:

introduce command registry

extract commands into modules

move business rules into use cases

keep gateway platform-specific

keep API/UI contract-driven

preserve behavior while improving structure

14. Refactor roadmap (high-level)
Phase 1

add configurable prefix

introduce command registry

stop growing core index

Phase 2

extract groups module

extract moderation module

extract reminders/tasks/notes modules

Phase 3

extract assistant-ai module boundaries

reduce gateway/core coupling

Phase 4

make help fully registry-driven

stabilize integration contracts

prepare media/fun module on top of modular base

15. Architecture decision summary

Zappy is intentionally evolving toward:

Modular Monolith + Hexagonal Architecture + Use Cases per Module + Registry-driven Commands

This is the preferred long-term structure for maintainability, extensibility, and future multi-platform evolution.


---

# `INTEGRATION_CONTRACTS.md`

```md
# INTEGRATION_CONTRACTS.md

# Zappy Assistant — Integration Contracts

This document defines the expected contracts for Admin API, Admin UI, and external builders/platforms such as Lovable, Cody, or other UI generators.

---

## 1. Authentication

All protected admin endpoints require:

```http
Authorization: Bearer <ADMIN_API_TOKEN>

If invalid or missing:

{ "error": "Unauthorized" }
