# AGENTS.md

This repository is a **modular monolith** for Zappy Assistant.

The architectural target is:

- **Modular Monolith**
- **Hexagonal Architecture / Ports and Adapters**
- **Use Cases per Module**
- **Single codebase, multiple runtime apps**
- **Command Registry for bot commands**
- **Transport-agnostic core logic**

This file defines how coding agents must work in this repository.

---

## 1. Core architectural direction

Zappy Assistant must evolve as a **modular monolith**, not as a growing god-file.

### Non-negotiable rule
Do **not** continue to grow `packages/core/src/index.ts` with new business logic.

`packages/core/src/index.ts` should progressively become only:

- ingress pipeline
- context resolution orchestration
- dispatch to modules / use cases
- outbound action normalization

Business rules, commands, and feature logic must live in modules.

---

## 2. Repository mental model

### Runtime apps
- `apps/wa-gateway`  
  WhatsApp/Baileys ingress/egress, message normalization, platform-specific actions.

- `apps/assistant-api`  
  Admin/ops HTTP API, status, queues, metrics, audit read endpoints.

- `apps/worker`  
  BullMQ workers, reminders, delayed jobs, background processing.

- `apps/admin-ui`  
  UI that consumes `assistant-api` only.

### Shared packages
- `packages/core`  
  Transport-agnostic application pipeline and module dispatch.

- `packages/adapters`  
  Concrete implementations for Prisma, Redis, BullMQ, OpenAI, Baileys-facing helpers, audit/metrics persistence.

- `packages/shared`  
  Env loading, logger, shared types/constants/utilities.

- `packages/ai`  
  Assistant persona, prompt building, tool-intent support, memory orchestration.

### Data / infra
- `prisma/`
- `infra/`

---

## 3. Modular structure rules

All new business capabilities must be implemented as modules by **business domain**, not by technical layer alone.

Preferred structure inside `packages/core/src/modules/<module-name>/`:

```text
modules/
  groups/
    application/
      use-cases/
      dto/
      policies/
    domain/
    ports/
    presentation/
      commands/
    index.ts

Each module should contain:

application/use-cases/

domain/

ports/

presentation/commands/

optional policies/, dto/, mappers/

Good examples

modules/groups/application/use-cases/set-group-name.ts

modules/reminders/application/use-cases/create-reminder.ts

modules/moderation/presentation/commands/mute.command.ts

Avoid

adding large new logic directly in packages/core/src/index.ts

dumping unrelated features in generic utils/

putting SDK calls directly in core use cases

creating one giant commands.ts

4. Ports and adapters rules

The core must depend on ports, never on concrete SDKs or frameworks.

Examples of ports

LlmPort

QueuePort

AuditPort

MetricsPort

GroupRepositoryPort

ReminderRepositoryPort

GroupPlatformPort

MessagePlatformPort

Adapter rules

Concrete implementations belong in packages/adapters or runtime apps.

Examples:

Prisma adapter

Redis adapter

BullMQ adapter

OpenAI adapter

Baileys-specific platform adapter

Forbidden

Do not import:

Baileys

Prisma client

Redis client

BullMQ

OpenAI SDK

directly inside module use cases unless the file is explicitly an adapter.

5. Command system rules

Zappy must use a central command registry.

Every command definition must have metadata such as:

name

aliases

scope (direct, group, both)

requiredRole

botAdminRequired

description

usage

examples

handler / bound use case

Important

/help must be generated from registry metadata, not hardcoded manually forever.

unknown commands must not silently fall into AI without deliberate policy.

prefix handling must be centralized.

6. Prefix handling

Command prefix must be configurable through environment:

BOT_PREFIX=/

Rules:

default prefix is /

changing BOT_PREFIX changes command parsing globally

help text and usage text must reflect the active prefix

parsers must not hardcode /

Future-friendly design:

global prefix now

prefix per tenant/group later if needed

7. Group behavior rules

Current supported ideas:

allowed groups

chat on/off

addressed messages via mention/reply

operation-first bot-admin checks

onboarding/consent in direct chat

moderation base

group settings

When adding group features:

keep plain non-addressed chatter ignored

use operation-first strategy for admin-required platform actions

keep requester authorization separate from bot-admin capability

always prefer explicit, auditable behavior

8. AI / assistant behavior rules

AI usage must be policy-driven, not accidental.

AI may be used for:

addressed conversation

tool-intent recognition

structured fallback

persona-aware replies

AI must not become the default home for unfinished command parsing.

When a request maps to an implemented command or use case, prefer:

command / use case execution

AI only for slot-filling / clarification / presentation when appropriate

9. Admin API and Admin UI rules
Admin API

protected by ADMIN_API_TOKEN

returns stable contracts

should expose status, queues, metrics, commands, messages, settings gradually

Admin UI

consumes only Admin API

must not embed domain logic

must be driven by documented contracts

every new page should define:

endpoint used

fields expected

loading state

empty state

error state

10. Logging and observability rules

Development logging may be pretty/colored.
Production logging must remain structured and machine-friendly.

When adding logs:

avoid noisy giant dumps by default

use explicit one-line debug logs when diagnosing complex WhatsApp metadata

keep security-sensitive values redacted

never log full secrets/tokens

Metrics and audit are first-class concerns:

important actions should be auditable

important flows should increment metrics

11. Refactoring rules

Refactoring is now a project priority.

Rules for coding agents

prefer small internal PR-style steps

do not mix large feature expansion with major refactors in one change

preserve behavior first, improve structure second

move code before rewriting logic when possible

document architectural changes in ARCHITECTURE.md

Refactoring target

Progressively shrink packages/core/src/index.ts by extracting:

command registry

group module

moderation module

reminders/tasks/notes modules

assistant-ai module

12. Documentation rules

Whenever architecture or contracts change, update:

README.md when user-facing behavior changes

ARCHITECTURE.md when structure/pipeline changes

INTEGRATION_CONTRACTS.md when API/UI contracts change

13. Expected coding style

prefer explicit names over clever abstractions

keep module boundaries clear

prefer small files with single responsibility

keep transport/platform details outside the core domain

every command/use case should be testable in isolation

return normalized result objects where possible

14. Immediate roadmap guidance

Near-term priority order:

architectural refactor toward modules/use-cases/registry

command registry + configurable prefix

stabilize API/UI contracts

polish parsing and ergonomics

add media/fun/search/download modules on top of the improved architecture

Do not keep adding major features into the current central core file.