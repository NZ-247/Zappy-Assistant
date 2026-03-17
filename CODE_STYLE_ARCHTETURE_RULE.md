# CODE_STYLE_ARCHITECTURE_RULES.md

# Zappy Assistant — Code Style & Architecture Rules

This document defines the **coding standards and architectural rules** for the Zappy Assistant project.

Its purpose is to guarantee that the system remains:

- modular
- predictable
- maintainable
- scalable
- safe for refactoring

These rules apply to:

- human developers
- AI coding agents
- external contributors

All code contributions must respect the architectural principles described in:

- ARCHITECTURE.md
- MODULE_BLUEPRINT.md
- SYSTEM_PIPELINE_BLUEPRINT.md
- COMMAND_REGISTRY_BLUEPRINT.md
- EXTERNAL_INTEGRATIONS_BLUEPRINT.md

If a contribution violates these rules, it must be rejected or refactored.

---

# 1. Architectural principles

The project follows a **modular monolith architecture with hexagonal principles**.

Key principles:


modules contain business logic
ports define external boundaries
adapters implement integrations
core orchestrates the pipeline


The system must remain:


modular
loosely coupled
highly testable
integration-friendly


---

# 2. Core orchestrator rules

The core orchestrator is located in:


packages/core/src/index.ts


This file must remain **minimal**.

Allowed responsibilities:

- pipeline orchestration
- routing decisions
- command dispatch
- module coordination

Forbidden responsibilities:

- business logic
- parsing rules
- database access
- API calls
- AI prompt construction
- queue logic

If new logic appears in the orchestrator, it must be moved to a module.

---

# 3. Module structure rules

Every module must follow the official structure:

```
modules/<module-name>/

domain/
application/
presentation/
ports/
services/
policies/
index.ts
```

Example:

```
modules/tasks/

domain/
task.ts

application/
use-cases/
create-task.ts
list-tasks.ts
complete-task.ts

presentation/
commands/
task-commands.ts

ports/
task-repository.port.ts

services/
task-id.service.ts

policies/
task-permissions.policy.ts

index.ts
```

Rules:

- business logic goes in **use-cases**
- command handlers call **use-cases**
- ports define **external contracts**
- adapters implement **ports**

---

# 4. Use case rules

Use cases represent **application logic**.

Example:


create-task.ts
complete-task.ts
schedule-reminder.ts


Use cases must:

- be deterministic
- avoid platform-specific logic
- receive dependencies via ports
- return structured results

Forbidden in use-cases:

- direct database calls
- SDK calls
- messaging platform logic
- OpenAI API calls

Use cases must rely only on **ports**.

---

# 5. Command handler rules

Command handlers belong to:


`modules/<module>/presentation/commands/`


Responsibilities:

- parse command arguments
- validate command input
- call use cases
- return pipeline actions

Command handlers must not:

- implement business logic
- access repositories directly
- call external APIs
- duplicate parsing logic

All command metadata must live in the **command registry**.

---

# 6. Command registry rules

The command registry is the **single source of truth for commands**.

Location:


`packages/core/src/commands/registry`


Every command must define:


`name`
`aliases`
`scope`
`role`
`description`
`usage`


Example:


`/task add`
`/task list`
`/task done`


Rules:

- help output must derive from the registry
- command prefix must come from `BOT_PREFIX`
- command handlers must match registry definitions

---

# 7. Ports and adapters rules

The project uses **ports and adapters**.

Ports define interfaces:

```
TaskRepositoryPort
ReminderRepositoryPort
LlmPort
QueuePort
MetricsPort
AuditPort
```

Adapters implement ports:

```
PrismaTaskRepository
OpenAILlmAdapter
BullQueueAdapter
RedisConversationStateAdapter
```

Rules:

Modules must **only depend on ports**.

Adapters must never be imported directly inside modules.

---

# 8. Adapter rules

Adapters belong to:


packages/adapters


Responsibilities:

- translate SDK behavior
- implement port interfaces
- normalize errors
- ensure safe failures

Adapters must not:

- contain business rules
- manipulate domain entities directly
- leak SDK-specific behavior to modules

Adapters should remain **thin integration layers**.

---

# 9. AI integration rules

All AI logic must go through the **assistant-ai module**.

Location:


`modules/assistant-ai`


Responsibilities:

- AI routing
- tool intent classification
- fallback responses
- slot filling

Forbidden:

- calling OpenAI directly in the core
- calling OpenAI directly inside modules
- mixing AI prompt logic with command logic

The AI service must always be accessed through the `LlmPort`.

---

# 10. Pipeline action rules

Modules do not directly send platform messages.

Instead, they return **pipeline actions**.

Examples:

`reply_text`
`send_message`
`schedule_job`
`moderation_action`
`ai_tool_suggestion`


The gateway layer interprets these actions.

Benefits:

- platform independence
- easier testing
- multi-platform support

---

# 11. Logging rules

Logging must be:

- structured
- consistent
- minimal noise

Log format:


[service] [time] [level] message


Examples:

```
[SYSTEM] service started
[WA-IN] message received
[WA-OUT] reply sent
[AI] ai response
```

Logs must avoid:

- sensitive data
- API keys
- tokens
- user secrets

---

# 12. Environment configuration rules

Configuration must come from environment variables.

Example:


`BOT_PREFIX=/`
`OPENAI_API_KEY=`
`DATABASE_URL=`
`REDIS_URL=`
`ADMIN_API_TOKEN=`


Rules:

- never hardcode secrets
- maintain `.env.example`
- validate env values at startup

---

# 13. Dependency rules

Allowed dependency flow:


modules → ports
adapters → ports
core → modules
gateway → core
worker → core


Forbidden:


modules → adapters
modules → gateway
modules → external SDKs


This preserves architecture boundaries.

---

# 14. Naming conventions

Use descriptive names.

Examples:

Use cases:


`create-task.ts`
`complete-task.ts`
`schedule-reminder.ts`


Services:


`task-id.service.ts`
`duration-parser.service.ts`


Policies:


`consent-bypass.policy.ts`
`moderation-policy.ts`


Avoid generic names like:


`utils.ts`
`helpers.ts`
`misc.ts`


---

# 15. Code style guidelines

General style rules:

- small focused files
- explicit typing
- descriptive variable names
- avoid deeply nested logic
- prefer pure functions

Prefer:


`function createTask(input)`


Avoid:


`function doStuff()`


Code should prioritize readability over cleverness.

---

# 16. Refactoring rules

When refactoring:

- keep behavior unchanged
- preserve public contracts
- update tests if needed
- move logic into modules rather than expanding core

Refactoring must improve:

- clarity
- modularity
- maintainability

---

# 17. Pull request expectations

All contributions must:

- respect module boundaries
- maintain registry consistency
- avoid expanding the core orchestrator
- include tests when appropriate
- update documentation when needed

---

# 18. AI coding agent guidelines

When an AI agent generates code:

It must:

- follow module blueprint
- update command registry when adding commands
- avoid adding logic to the orchestrator
- define ports before adapters
- place business logic in use cases

Agents must never bypass architecture rules for convenience.

---

# 19. Architecture protection rule

If a feature request conflicts with the architecture:

The architecture wins.

Instead of violating architecture:

- create a new module
- define new ports
- implement adapters

This protects long-term maintainability.

---

# 20. Long-term architectural goal

Zappy Assistant aims to become:

- a modular conversational assistant
- an automation orchestration platform
- a multi-platform messaging system
- an AI-driven integration hub

To achieve that, the architecture must remain:


predictable
modular
extensible
testable


Every code contribution must move the project **toward this goal**.