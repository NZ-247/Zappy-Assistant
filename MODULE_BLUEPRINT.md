# MODULE_BLUEPRINT.md

# Zappy Assistant — Module Blueprint

This document defines the **target internal structure** for modules inside `packages/core/src/`.

It is the fixed blueprint that coding agents must follow when extracting logic from the central core and when adding new features.

This blueprint exists to prevent:
- god files
- feature sprawl inside `packages/core/src/index.ts`
- accidental coupling between unrelated capabilities
- direct platform/framework leakage into core use cases

---

## 1. Architectural goal

Zappy Assistant must evolve as a **modular monolith**.

Each business capability must be implemented as a **module** with clear boundaries.

The preferred pattern is:

- `application/` for use cases
- `domain/` for core concepts and rules
- `ports/` for interfaces
- `presentation/` for command/input mapping
- `index.ts` as module export/composition boundary

---

## 2. Root target structure inside `packages/core/src`

```text
packages/core/src/
  pipeline/
    types.ts
    context.ts
    actions.ts
    classification.ts
    dispatch.ts
    outbound.ts

  commands/
    registry/
      index.ts
      command-types.ts
      command-groups.ts
    parser/
      parse-command.ts
      prefix.ts
      parse-result.ts

  modules/
    identity/
    consent/
    groups/
    moderation/
    reminders/
    tasks/
    notes/
    assistant-ai/
    admin/
    observability/
    media-fun/
  ```

## 3. Shared pipeline layer

These files contain transport-agnostic shared application contracts.

3.1 pipeline/types.ts

Purpose:

normalized inbound message types

normalized conversation context types

shared request/result DTOs used across modules

Examples:

InboundMessage

ResolvedIdentity

GroupContext

ConversationContext

CommandInvocation

IntentClassification

3.2 pipeline/context.ts

Purpose:

application-level pipeline context

dependencies passed into dispatch/use-case orchestration

no business rules here

Examples:

PipelineContext

ExecutionContext

FeatureFlagsContext

3.3 pipeline/actions.ts

Purpose:

normalized outbound actions

Examples:

ReplyTextAction

ReplyListAction

GroupAdminAction

ModerationAction

EnqueueJobAction

NoopAction

3.4 pipeline/classification.ts

Purpose:

intent classification contracts and helpers

prefix/mention/reply/trigger/AI route classification result shapes

3.5 pipeline/dispatch.ts

Purpose:

application dispatcher contracts

route classification -> module/use case execution

3.6 pipeline/outbound.ts

Purpose:

outbound rendering helpers / normalized formatting contracts

no platform SDK calls

## 4. Command system structure

Command handling is a first-class system.

4.1 commands/registry/command-types.ts

Purpose:

command metadata contracts

Examples:

CommandDefinition

CommandScope

RequiredRole

CommandCategory

Minimum fields for each command:

name

aliases

category

scope

requiredRole

botAdminRequired

description

usage

examples

4.2 commands/registry/command-groups.ts

Purpose:

grouped command metadata by module/category

used by help generation later

Examples:

groupCommands

moderationCommands

reminderCommands

taskCommands

4.3 commands/registry/index.ts

Purpose:

central command registry assembly

import grouped command definitions from modules/categories

expose lookup helpers

4.4 commands/parser/prefix.ts

Purpose:

prefix helpers

active prefix resolution

prefix-safe command rendering

Examples:

getActivePrefix()

withPrefix("help") => "/help"

4.5 commands/parser/parse-result.ts

Purpose:

parsed command result contracts

Examples:

ParsedCommandMatch

UnknownCommand

NotACommand

4.6 commands/parser/parse-command.ts

Purpose:

parse text into command invocation using registry and active prefix

no business logic here

## 5. Standard module layout

Every module should follow this structure when applicable:

modules/
  <module-name>/
    application/
      use-cases/
      services/
      dto/
      policies/
    domain/
      entities/
      value-objects/
      rules/
      events/
    ports/
      inbound/
      outbound/
      repositories/
    presentation/
      commands/
      mappers/
      validators/
    index.ts

Not every folder is mandatory for every module, but the structure should remain recognizable.

## 6. Meaning of each module layer
6.1 application/use-cases/

Contains business workflows.

Examples:

create reminder

mute user

set group name

list tasks

accept consent

Rules:

can depend on ports

can coordinate repositories, metrics, queue, audit

must not call framework SDKs directly

6.2 application/services/

Contains orchestration helpers internal to the module.

Examples:

reminder time parser service

moderation policy evaluator

consent decision service

Use only when a use case would otherwise become too large.

6.3 application/dto/

Input/output DTOs for use cases.

Examples:

CreateReminderInput

MuteUserInput

SetGroupNameInput

6.4 application/policies/

Module-level policies and guards.

Examples:

permission policy

chat mode policy

moderation enforcement policy

6.5 domain/entities/

Core entities when needed.

Examples:

Task

Reminder

GroupSettings

ConsentRecord

6.6 domain/value-objects/

Small immutable typed concepts.

Examples:

DurationValue

CommandPrefix

ReminderSchedule

PermissionRoleValue

6.7 domain/rules/

Pure domain rules.

Examples:

reminder validity

permission escalation rules

moderation restrictions

6.8 domain/events/

Optional domain-level events when useful.

Examples:

ReminderCreated

ConsentAccepted

UserMuted

6.9 ports/repositories/

Repository contracts used by the module.

Examples:

ReminderRepository

TaskRepository

GroupSettingsRepository

6.10 ports/outbound/

Other external dependency contracts.

Examples:

QueuePort

LlmPort

AuditPort

MetricsPort

GroupPlatformPort

6.11 ports/inbound/

Optional input ports if the module defines a callable façade.

This is helpful when the module exports a stable application contract.

6.12 presentation/commands/

Command mapping layer.

Examples:

parse /set gp name

parse /mute @user 10m

map command invocation -> use case input

Rules:

this layer may interpret command arguments

this layer must not own core business rules

this layer must call module use cases

6.13 presentation/mappers/

Maps pipeline DTOs or command data into module DTOs.

6.14 presentation/validators/

Lightweight validation for command syntax/input shape before use case execution.

## 7. Module-by-module blueprint
7.1 modules/identity/
identity/
  application/
    use-cases/
      resolve-canonical-identity.ts
      resolve-relationship-profile.ts
    dto/
      resolve-identity-input.ts
      resolve-identity-output.ts
  domain/
    entities/
      identity.ts
    value-objects/
      canonical-user-id.ts
      relationship-profile.ts
    rules/
      privileged-identity-rules.ts
  ports/
    repositories/
      identity-repository.ts
    outbound/
      audit-port.ts
      metrics-port.ts
  presentation/
    mappers/
      inbound-message-to-identity-input.ts
  index.ts

Responsibilities:

canonical identity resolution

PN/LID alias handling

relationship profile resolution

privileged identity rules

7.2 modules/consent/
consent/
  application/
    use-cases/
      check-consent-gate.ts
      accept-consent.ts
      decline-consent.ts
    dto/
      consent-input.ts
      consent-result.ts
    policies/
      consent-bypass-policy.ts
  domain/
    entities/
      consent-record.ts
    rules/
      consent-state-rules.ts
  ports/
    repositories/
      consent-repository.ts
    outbound/
      audit-port.ts
      metrics-port.ts
  presentation/
    commands/
      consent-commands.ts
  index.ts

Responsibilities:

onboarding consent gate

accept/decline flow

privileged bypass

7.3 modules/groups/
groups/
  application/
    use-cases/
      get-group-info.ts
      set-group-chat-mode.ts
      set-group-name.ts
      set-group-description.ts
      set-group-rules.ts
      set-group-fixed-message.ts
      set-group-welcome-message.ts
      allow-group.ts
      remove-allowed-group.ts
      list-allowed-groups.ts
      set-group-open.ts
      set-group-close.ts
      set-group-image.ts
    dto/
      group-command-input.ts
      group-info-output.ts
    policies/
      group-access-policy.ts
      chat-mode-policy.ts
      bot-admin-policy.ts
  domain/
    entities/
      group-settings.ts
    value-objects/
      group-id.ts
      chat-mode.ts
    rules/
      group-permission-rules.ts
  ports/
    repositories/
      group-repository.ts
      allowed-group-repository.ts
    outbound/
      group-platform-port.ts
      audit-port.ts
      metrics-port.ts
  presentation/
    commands/
      group-commands.ts
    mappers/
      group-command-mapper.ts
    validators/
      group-command-validator.ts
  index.ts

Responsibilities:

group settings

allowed groups

chat mode

open/close

name/description/image

rules/fixed/welcome content

7.4 modules/moderation/
moderation/
  application/
    use-cases/
      mute-user.ts
      unmute-user.ts
      kick-user.ts
      ban-user.ts
      hide-tag.ts
      enforce-anti-link.ts
    dto/
      moderation-input.ts
      moderation-result.ts
    policies/
      moderation-policy.ts
  domain/
    entities/
      mute-record.ts
      moderation-config.ts
    value-objects/
      moderation-duration.ts
    rules/
      moderation-rules.ts
  ports/
    repositories/
      moderation-repository.ts
    outbound/
      group-platform-port.ts
      message-platform-port.ts
      audit-port.ts
      metrics-port.ts
  presentation/
    commands/
      moderation-commands.ts
    validators/
      moderation-command-validator.ts
  index.ts

Responsibilities:

mute/unmute

kick/ban

hidetag

anti-link behavior

7.5 modules/reminders/
reminders/
  application/
    use-cases/
      create-reminder.ts
      list-reminders.ts
      cancel-reminder.ts
      update-reminder.ts
    services/
      reminder-time-parser.ts
    dto/
      create-reminder-input.ts
      reminder-output.ts
    policies/
      reminder-permission-policy.ts
  domain/
    entities/
      reminder.ts
    value-objects/
      reminder-id.ts
      reminder-schedule.ts
    rules/
      reminder-rules.ts
  ports/
    repositories/
      reminder-repository.ts
    outbound/
      queue-port.ts
      audit-port.ts
      metrics-port.ts
  presentation/
    commands/
      reminder-commands.ts
    validators/
      reminder-command-validator.ts
  index.ts

Responsibilities:

create/list/cancel/update reminders

schedule queue jobs

parse human-friendly time inputs

7.6 modules/tasks/
tasks/
  application/
    use-cases/
      create-task.ts
      list-tasks.ts
      complete-task.ts
      update-task.ts
      remove-task.ts
    dto/
      task-input.ts
      task-output.ts
  domain/
    entities/
      task.ts
    value-objects/
      task-id.ts
    rules/
      task-rules.ts
  ports/
    repositories/
      task-repository.ts
    outbound/
      audit-port.ts
      metrics-port.ts
  presentation/
    commands/
      task-commands.ts
    validators/
      task-command-validator.ts
  index.ts

Responsibilities:

task lifecycle

task listing and completion

7.7 modules/notes/
notes/
  application/
    use-cases/
      add-note.ts
      list-notes.ts
      remove-note.ts
    dto/
      note-input.ts
      note-output.ts
  domain/
    entities/
      note.ts
    value-objects/
      note-id.ts
  ports/
    repositories/
      note-repository.ts
    outbound/
      audit-port.ts
      metrics-port.ts
  presentation/
    commands/
      note-commands.ts
  index.ts

Responsibilities:

quick notes in direct/group context

7.8 modules/assistant-ai/
assistant-ai/
  application/
    use-cases/
      handle-addressed-message.ts
      infer-tool-intent.ts
      run-slot-filling.ts
    services/
      ai-routing-service.ts
      ai-fallback-service.ts
    dto/
      ai-input.ts
      ai-output.ts
    policies/
      ai-routing-policy.ts
  domain/
    value-objects/
      persona-profile.ts
      assistant-mode.ts
  ports/
    outbound/
      llm-port.ts
      memory-port.ts
      audit-port.ts
      metrics-port.ts
  presentation/
    mappers/
      pipeline-to-ai-input.ts
  index.ts

Responsibilities:

addressed conversation

tool-intent recognition

slot filling

persona-aware replies

7.9 modules/admin/
admin/
  application/
    use-cases/
      get-system-status.ts
      get-queue-summary.ts
      get-command-feed.ts
      get-message-feed.ts
      get-metrics-summary.ts
    dto/
      admin-status-output.ts
      queue-summary-output.ts
  ports/
    outbound/
      status-port.ts
      queue-metrics-port.ts
      audit-read-port.ts
      metrics-read-port.ts
  presentation/
    mappers/
      admin-response-mapper.ts
  index.ts

Responsibilities:

admin-facing operational read models

7.10 modules/observability/
observability/
  application/
    use-cases/
      record-command-audit.ts
      record-message-metric.ts
      record-moderation-metric.ts
    dto/
      audit-input.ts
      metric-input.ts
  ports/
    outbound/
      audit-port.ts
      metrics-port.ts
      heartbeat-port.ts
  index.ts

Responsibilities:

audit/metrics helpers as module-level services

optional consolidation point for cross-cutting observability logic

7.11 modules/media-fun/ (future)
media-fun/
  application/
    use-cases/
      create-sticker.ts
      text-to-speech.ts
      search-image.ts
      download-media.ts
    dto/
      media-input.ts
      media-output.ts
    policies/
      fun-mode-policy.ts
  domain/
    value-objects/
      media-request.ts
  ports/
    outbound/
      media-platform-port.ts
      external-search-port.ts
      file-download-port.ts
      ffmpeg-port.ts
      tts-port.ts
  presentation/
    commands/
      media-commands.ts
  index.ts

Responsibilities:

entertainment/media/search/download features

guarded by fun mode and permission policies

## 8. Rules for adding a new feature

When adding a new capability:

Identify the business module it belongs to

Add/update command metadata in registry group file

Add presentation command mapper/validator

Add use case in application/use-cases/

Add/update ports

Implement concrete adapter outside the core if needed

Update help metadata

Update docs/contracts if API/UI changes

## 9. Rules for extracting from packages/core/src/index.ts

When moving logic out of the core index:

move shared types to pipeline/* first if needed

move command mapping into module presentation/commands

move business decisions into module application/use-cases

keep platform details in gateway/adapters

keep behavior unchanged whenever possible

shrink index.ts gradually

## 10. Things modules must NOT do

Modules must not:

import Baileys directly

import Prisma directly

import BullMQ directly

import OpenAI SDK directly

depend on packages/core/src/index.ts as their main type source

hide business rules inside generic utils

parse raw WhatsApp payloads directly

## 11. What packages/core/src/index.ts should become

Long-term, packages/core/src/index.ts should only:

receive normalized pipeline input

resolve context

classify intent

dispatch to module entrypoints

collect normalized outbound actions

It should not remain the permanent home of:

command implementations

moderation rules

reminder business logic

group configuration workflows

consent state machines

AI routing details

## 12. Blueprint enforcement rule

Any new module or refactor step should follow this document unless there is a strong reason not to.

If a coding agent introduces a new feature outside this blueprint, that should be treated as technical debt and corrected quickly.