# TESTING_STRATEGY.md

# Zappy Assistant — Testing Strategy

This document defines the official testing strategy for the Zappy Assistant project.

Its purpose is to ensure that the system remains:

- reliable
- maintainable
- modular
- safe to refactor
- safe to expand

This strategy is aligned with:

- modular monolith architecture
- hexagonal architecture
- command registry driven behavior
- pipeline-based message orchestration
- external integrations via ports/adapters

This document is intended for:

- coding agents
- human developers
- future maintainers
- CI/CD pipeline configuration

---

# 1. Testing principles

The project must prioritize:

1. deterministic tests
2. fast feedback loops
3. isolation of business logic
4. minimal reliance on live external systems
5. confidence during refactoring

The most important rule is:

**Core business logic must be testable without WhatsApp, OpenAI, Prisma, Redis, or any live external service.**

---

# 2. Test pyramid

The preferred test distribution is:

```text
Many unit tests
Some module/service tests
Few integration tests
Very few end-to-end tests
```
Priority order:

1. `Unit tests`

2. `Module-level tests`

3. `Adapter integration tests`

4. `Pipeline integration tests`

4. `Gateway end-to-end smoke tests`

# 3. Test categories
## 3.1 Unit tests

Unit tests validate:

 - pure functions

 - parsers

 - mappers

 - validators

 - domain rules

 - small use cases with mocked ports

Examples:

 - command parsing

 - duration parsing

 - public ID generation

 - permission rules

 - consent bypass rules

 - tool intent classification

These tests must be:

 - fast

 - deterministic

 - isolated

## 3.2 Module tests

Module tests validate one module at a time.

Example modules:

 - identity

 - consent

 - groups

 - moderation

 - reminders

 - tasks

 - notes

 - assistant-ai

A module test may instantiate:

 - one or more use cases

 - mocked repositories

 - mocked ports

 - fake audit/metrics ports

These tests should verify:

 - business behavior

 - command-to-use-case mapping

 - expected output actions

 - error handling

## 3.3 Integration tests

Integration tests validate real interaction between components.

Examples:

 - core + adapters with test database

 - worker + queue

 - assistant-api + redis heartbeats

 - registry + parser + command handler together

These tests should still avoid live third-party services whenever possible.

## 3.4 End-to-end tests

End-to-end tests validate full system flows.

Examples:

 - inbound message → parsed → dispatched → response action

 - onboarding consent flow

 - group command flow

 - reminder scheduling flow

These tests should be limited in number because they are slower and more fragile.

# 4. Recommended test locations

Tests should live close to the code they validate whenever practical.

Recommended layout:
```
packages/core/src/
  commands/
    parser/
      __tests__/
  modules/
    tasks/
      application/
        use-cases/
          __tests__/
    consent/
      application/
        use-cases/
          __tests__/
    assistant-ai/
      application/
        use-cases/
          __tests__/
```

```
packages/adapters/
  src/
    __tests__/
```

```
apps/wa-gateway/src/
  __tests__/
```

Alternative acceptable pattern:
```
tests/
  unit/
  integration/
  e2e/
```

Preferred project direction:

 - unit and module tests close to source

 - broader integration tests in dedicated test folders if needed

# 5. What must be tested first

The system should prioritize tests around the highest-value and highest-risk areas.

## Tier 1 — Critical

Must have coverage:

 - command parser

 - command registry lookup

 - consent gating

 - identity resolution rules

 - assistant-ai fallback behavior

 - reminder scheduling logic

 - task public IDs

 - note public IDs

 - permission/role gating

 - group addressed-message routing

## Tier 2 — Important

Should have coverage:

 - moderation actions

 - group settings updates

 - help rendering

 - command usage fallback

 - onboarding messages

 - admin status aggregation

## Tier 3 — Nice to have

Can be added later:

 - full gateway message formatting

 - extensive UI route coverage

 - deep adapter edge cases

 - stress/performance tests

# 6. Testing by architectural layer
## 6.1 Pipeline tests

Files typically involved:

 - `pipeline/types.ts`

 - `pipeline/context.ts`

 - `pipeline/actions.ts`

 - dispatch logic in core

Test goals:

 - correct normalized action shapes

 - correct dispatch decisions

 - predictable routing behavior

Examples:

 - prefixed command goes to command flow

 - direct plain text goes to AI flow

 - group non-addressed chatter is ignored

 - consent gate blocks normal execution

## 6.2 Command system tests

Files typically involved:

 - `commands/parser/*`

 - `commands/registry/*`

 - `commands/help-renderer.ts`

Test goals:

 - prefix-aware parsing

 - alias resolution

 - incomplete command detection

 - scope filtering

 - role filtering

 - help generation consistency

Examples:

 - `/task add foo`

 - `.task add foo` when `BOT_PREFIX=.`

 - `/note` → usage, not AI

 - `/help` filtered for direct vs group

## 6.3 Module tests

Each module should validate:

### Identity

 - canonical identity resolution

 - privileged profile matching

 - PN/LID alias handling

### Consent

 - pending state

 - accept flow

 - decline flow

 - privileged bypass

 ### Groups

 - allowed-group rules

 - chat mode handling

 - open/close commands

 - group settings persistence

### Moderation

 - mute/unmute

 - duration parsing

 - anti-link policy decisions

### Reminders

 - reminder creation

 - date parsing

 - duration parsing

 - cancellation/update behavior

 ### Tasks

 - task creation

 - public ID generation

 - completion by public ID

 - compatibility with internal UUID

 ### Notes

 - note creation

 - public ID generation

 - listing/removal

 ### Assistant-AI

 - addressed message routing

 - tool intent selection

 - slot filling transitions

 - fallback on LLM unavailable

## 6.4 Adapter tests

Adapters should be tested with focus on:

 - contract adherence

 - error translation

 - safe failure handling

Examples:

### OpenAI adapter

 - returns expected normalized output

 - handles timeout

 - handles quota/rate-limit failure

 - maps errors to safe fallback types

### Redis adapter

 - stores/retrieves conversation state correctly

 - respects TTL

 - Prisma repositories

 - persist and retrieve expected domain data

 - support required query patterns

 - Queue adapter

 - enqueue reminder jobs correctly

 - update/cancel logic works

Important:
Adapter tests should not leak SDK-specific assumptions into core tests.

# 7. Mocking strategy
## 7.1 What should be mocked

Mock these in most tests:

 - LlmPort

 - QueuePort

 - AuditPort

 - MetricsPort

 - repositories

 - group platform operations

 - message platform operations

## 7.2 What should not be mocked in pure unit tests

Avoid testing:

 - live Redis

 - live PostgreSQL

 - live BullMQ

 - live OpenAI

 - live Baileys

unless the test is explicitly an integration test.

## 7.3 Preferred mocks

Preferred fake implementations:

 - `FakeTaskRepository`
 - `FakeReminderRepository`
 - `FakeConsentRepository`
 - `FakeLlmPort`
 - `FakeAuditPort`
 - `FakeMetricsPort`
 - `FakeConversationStatePort`

These fakes should be simple and deterministic.

# 8. Contract testing

The project uses ports and adapters.

Each adapter should be tested against a contract.

Example:

If `TaskRepositoryPort` guarantees:

 - create

 - find by public ID

 - list by scope

 - complete task

then repository tests must verify those behaviors directly.

This prevents drift between:

 - module expectation

 - adapter implementation

# 9. Regression testing

Whenever a bug is fixed:

1. write a test that reproduces it

2. confirm the test fails before the fix

3. confirm it passes after the fix

Examples of likely regression cases:

 - group mention detection by LID

 - reply-to-bot detection

 - bot admin informational status

 - consent bypass for privileged users

 - public ID parsing for tasks/notes

 - command falling into AI incorrectly

# 10. Snapshot testing

Snapshot testing may be used sparingly for:

 - help output

 - admin status summaries

 - formatted WhatsApp-friendly text blocks

Do not overuse snapshots for unstable or noisy outputs.

Snapshots should never replace behavioral assertions.

# 11. Performance testing

A small set of performance-oriented tests may be added later for:

 - command parsing speed

 - help rendering speed

 - routing latency

 - large registry lookup performance

Targets:

 - command parsing should be effectively near-instant

 - normal command flows should remain low latency

 - no stage should introduce unnecessary blocking work

These tests are optional early on, but recommended later.

# 12. Smoke testing checklist

Before merging major refactors, perform smoke tests for:

Direct chat

 - `/help`

 - `/status`

 - `/task add`

 - `/task list`

 - `/task done`

 - `/note add`

 - `/note list`

 - plain AI message

 - consent onboarding for new user

Group chat

 - `/groupinfo`

 - `/set gp chat on|off`

 - mention-based AI response

 - reply-to-bot AI response

 - non-addressed chatter ignored

 - `/mute`

 - `/hidetag`

 - welcome/rules/fix commands

Reminder flow

 - create reminder

 - trigger worker delivery

 - update/cancel reminder if supported

# 13. CI expectations

Continuous integration should run at least:

Minimum CI

 - typecheck/build

 - unit tests

 - module tests

Stronger CI later

 - selected integration tests

 - adapter contract tests

 - smoke workflow tests

Recommended CI order:
```
install
→ lint (if enabled)
→ build
→ unit tests
→ module tests
→ selected integration tests
```

# 14. Test naming conventions

Use descriptive names.

Good examples:
```
should_accept_task_public_id_when_completing_task
should_block_non_consented_user_before_ai_routing
should_route_group_reply_to_assistant_ai_module
should_return_usage_for_incomplete_note_command
```

Bad examples:
```
task test
note works
ai check
```

# 15. Testing rules for coding agents

When a coding agent changes behavior in:

 - command parsing

 - consent

 - assistant-ai

 - group routing

 - public ID logic

 - reminder scheduling

 - moderation policies

the agent should:

 1. add or update tests

 2. keep tests close to the affected module

 3. avoid large fragile end-to-end rewrites when a focused module test is enough

# 16. Current recommended priority roadmap
Immediate next testing priorities

 - command parser + registry lookup

 - consent module

 - assistant-ai module

 - task public ID flows

 - note public ID flows

After that

 - group routing

 - moderation policies

 - reminder scheduling/cancel/update

 - admin status summary

 - adapter contract tests


# 17. Long-term testing vision

The long-term goal is:

 - fast unit confidence

 - stable module confidence

 - minimal regressions during refactor

 - safe external integration expansion

 - safe multi-platform growth

Zappy Assistant should be able to evolve quickly without losing correctness.

That requires the testing strategy to evolve with the architecture, but always preserve one core principle:

Business logic must remain easy to test in isolation.