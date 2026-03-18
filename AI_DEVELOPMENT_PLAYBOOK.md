# AI_DEVELOPMENT_PLAYBOOK.md

# Zappy Assistant — AI Development Playbook

This document defines how AI coding agents must interact with, modify, and extend the Zappy Assistant codebase.

It is a **strict operational guide** for:

- Codex
- Copilot
- Cody
- Lovable
- any automated code generation system

The goal is to ensure that all AI-generated code:

- respects architecture
- maintains modularity
- avoids regressions
- integrates cleanly
- remains testable

This playbook must be followed together with:

- ARCHITECTURE.md
- MODULE_BLUEPRINT.md
- SYSTEM_PIPELINE_BLUEPRINT.md
- COMMAND_REGISTRY_BLUEPRINT.md
- CODE_STYLE_ARCHITECTURE_RULES.md
- TESTING_STRATEGY.md

---

# 1. Core principle

AI agents must treat this project as a **modular, pipeline-driven system**.

The most important rule:

**Never prioritize speed of implementation over architectural correctness.**

---

# 2. How to understand the system

Before making changes, the agent must:

1. Identify the request type:


new feature
bug fix
refactor
integration


2. Identify affected layers:


command layer
module (which module?)
pipeline
adapter
gateway


3. Locate relevant files:

- command registry
- module use-cases
- ports
- adapters

4. Understand flow:


Inbound message
→ parser
→ command OR AI routing
→ module use-case
→ pipeline action
→ gateway dispatch


---

# 3. Feature implementation workflow

When adding a new feature, follow this exact sequence:

## Step 1 — Choose module

Determine if:

- feature belongs to an existing module
- or requires a new module

If new module:

Create structure:

```
modules/<feature>/
domain/
application/use-cases/
presentation/commands/
ports/
services/
policies/
index.ts
```

---

## Step 2 — Define use case

Create a use-case file:


`application/use-cases/<action>.ts`


The use case must:

- receive input
- use ports
- return structured result
- not depend on external SDKs

---

## Step 3 — Define ports

If needed, create new ports:


`ports/<feature>.port.ts`


Ports define required external behavior.

---

## Step 4 — Update command registry

Add command metadata:

- name
- aliases
- usage
- description
- role
- scope

Location:


`packages/core/src/commands/registry`


---

## Step 5 — Implement command handler

Location:


`presentation/commands/`


Responsibilities:

- parse arguments
- validate input
- call use case
- return pipeline actions

---

## Step 6 — Wire in core (minimal)

Only if necessary:

- register handler
- ensure routing works

Never add logic to core.

---

## Step 7 — Add tests

Add:

- unit tests (use case)
- command tests
- edge case tests

---

# 4. Bug fix workflow

When fixing a bug:

1. Identify root cause:
   - parser?
   - module?
   - adapter?
   - pipeline?

2. Write regression test first (if possible)

3. Apply minimal fix

4. Validate:

- no regression
- no architecture violation

---

# 5. Refactor workflow

Refactoring must:

- not change behavior
- reduce complexity
- improve modularity

Allowed refactors:

- extract logic to module
- split large files
- introduce ports
- remove duplication

Forbidden:

- changing external behavior silently
- breaking command contracts
- moving logic into core

---

# 6. Command-related rules

When working with commands:

- always update registry
- never hardcode prefix
- use prefix utilities
- return usage on incomplete commands

Example:


/task
→ return usage
NOT AI fallback


---

# 7. AI-related rules

AI must be handled only by:


`modules/assistant-ai`


Agents must:

- never call OpenAI directly
- use LlmPort
- respect fallback behavior
- preserve slot-filling logic

---

# 8. Pipeline rules

Agents must respect pipeline flow:


`input → normalize → route → execute → output action`


Never:

- send messages directly from modules
- bypass pipeline actions
- embed platform logic in modules

---

# 9. Integration workflow

When integrating external systems:

1. Define port
2. Implement adapter
3. Wire adapter at runtime
4. Use from module via port

Never:

- import SDK inside module
- bypass adapter layer

---

# 10. Anti-patterns (forbidden)

AI agents must NEVER:

- add business logic to core
- call OpenAI directly in modules
- access database directly in use-cases
- bypass command registry
- duplicate logic across modules
- introduce "quick fixes" that break architecture

---

# 11. Decision guidelines

When uncertain:

Prefer:


`new module > modifying core`
`use-case > inline logic`
`port > direct integration`


---

# 12. Testing expectations

Every meaningful change must include:

- unit test OR
- module test OR
- regression test

Tests must:

- not depend on live services
- use mocks or fakes

---

# 13. Performance awareness

Agents must avoid:

- blocking operations
- unnecessary loops
- heavy synchronous work

Keep:

- command parsing fast
- routing lightweight
- module execution efficient

---

# 14. Documentation rules

When adding features:

Update:

- command registry metadata
- relevant docs if behavior changes

---

# 15. Safe iteration model

Agents must work incrementally:

Good:


`small change → test → validate → continue`


Bad:


large refactor without validation


---

# 16. How to extend modules safely

To extend a module:

1. add new use case
2. reuse existing ports
3. update command handler if needed
4. keep domain consistent

---

# 17. Multi-platform readiness

All code must assume future platforms.

Never:

- assume WhatsApp-specific behavior in modules

Always:

- return generic pipeline actions

---

# 18. Observability awareness

When relevant:

- log important actions
- emit metrics via ports
- record audit events

---

# 19. Failure handling

Agents must ensure:

- safe fallbacks
- no crashes on external failure
- user-friendly responses

---

# 20. Final rule

If an implementation:

- works
BUT
- breaks architecture

It must be rejected.

Architecture consistency is more important than short-term functionality.

---

# 21. Long-term goal

AI agents must evolve the system toward:

- modular growth
- clean separation of concerns
- integration capability
- multi-platform support
- AI-driven orchestration

Every change must move the system closer to this vision.