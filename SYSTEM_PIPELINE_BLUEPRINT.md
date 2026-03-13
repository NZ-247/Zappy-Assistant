# SYSTEM_PIPELINE_BLUEPRINT.md

# Zappy Assistant — System Pipeline Blueprint

This document describes the **ideal runtime execution pipeline** of the Zappy Assistant system.

It defines the **target architecture state**, not necessarily the current intermediate implementation.

This blueprint exists so that:

- coding agents understand the **final system design**
- refactoring steps converge toward a **stable architecture**
- future modules integrate consistently
- performance and reliability remain predictable

This pipeline reflects best practices from:

- modular monolith architectures
- hexagonal architecture
- event-driven assistants
- conversational orchestration systems

---

# 1. Architectural overview

The Zappy Assistant runtime follows a **deterministic message pipeline**.

The system processes messages through a sequence of stages.

```
Incoming Message
↓
Gateway normalization
↓
Identity resolution
↓
Consent gate
↓
Command parsing
↓
Command registry lookup
↓
Module dispatch
↓
AI routing (if needed)
↓
Response generation
↓
Outbound action execution
```

Each stage has a **strict responsibility**.

---

# 2. High-level pipeline stages

## Stage 1 — Gateway ingress

Responsible component:


`apps/wa-gateway`
`apps/<future-gateway>`


Responsibilities:

- receive platform events
- normalize platform payload
- remove SDK-specific structures
- create `InboundMessage`

Example normalized structure:

```ts
interface InboundMessage {
platform: "whatsapp"
chatType: "direct" | "group"
chatId: string
senderId: string
text?: string
mentionedIds?: string[]
quotedMessageId?: string
timestamp: number
}
```
Output:

`PipelineContext`

# 3. 
## Stage 2 — Identity resolution

Responsible module:

`modules/identity`

Responsibilities:

 - resolve canonical user identity

 - merge PN/LID identifiers

 - determine relationship profile

 - detect privileged users

Possible profiles:

`ROOT`
`ADMIN`
`OWNER`
`PRIVILEGED`
`USER`
`INTERNAL`

Output:

`ResolvedIdentity`


# 4. 
## Stage 3 — Consent gate

Responsible module:

`modules/consent`

Responsibilities:

 - enforce onboarding consent

 - allow privileged bypass

 - block assistant features until accepted

 - track consent state

Possible states:

`PENDING`
`ACCEPTED`
`DECLINED`

If PENDING, the pipeline returns:

`Consent prompt`

and stops execution.

# 5. 
## Stage 4 — Command parsing

Responsible system:

`commands/parser`

Responsibilities:

 - detect prefix

 - parse command name

 - parse arguments

 - detect command aliases

Prefix source:

`BOT_PREFIX`

Examples:
```
/task add
/task list
/help
```

Parser result types:

`NotACommand`
`ParsedCommand`
`IncompleteCommand`


# 6.
## Stage 5 — Registry lookup

Responsible system:

`commands/registry`

Responsibilities:

 - match command metadata

 - determine category

 - determine required role

 - determine command scope

 - determine bot admin requirement

Registry metadata is the single source of truth.

# 7.
## Stage 6 — Module dispatch

Responsible component:

`core orchestrator`

Responsibilities:

- route command to module handler

- enforce role permissions

 - enforce bot admin requirement

 - construct module input DTO

Example dispatch:
```
task command → modules/tasks
note command → modules/notes
group command → modules/groups
```
Core must ***not contain business logic.***

It only routes execution.

# 8.
## Stage 7 — Module execution

Responsible location:

`modules/<module>/application/use-cases`

Responsibilities:

 - execute business logic

 - call repositories

 - call external ports

 - produce domain result

Example modules:

`identity`
`consent`
`groups`
`moderation`
`reminders`
`tasks`
`notes`
`assistant-ai`
`admin`
`observability`
`media-fun`
`search`
`integrations`

Output:

`ResponseAction[]`

# 9.
## Stage 8 — AI routing

Responsible module:

`modules/assistant-ai`

AI routing occurs when:
```
NotACommand
AND
message addressed to assistant
```

Address detection rules:
```
direct message
@mention
reply to bot
conversation follow-up
```

AI module responsibilities:
```
tool intent detection
slot filling
natural language command inference
fallback responses
persona-aware replies
```

Possible outcomes:
```
tool invocation
slot prompt
AI response
fallback
```
# 10.
## Stage 9 — Response generation

Modules produce normalized actions.

Examples:
```
ReplyTextAction
ReplyListAction
ModerationAction
QueueJobAction
```

Example structure:
```
interface ReplyTextAction {
type: "reply_text"
text: string
}
```

The pipeline collects actions and sends them to the gateway.

# 11.
## Stage 10 — Outbound execution

Responsible component:

`apps/wa-gateway`

Responsibilities:

 - translate actions to platform operations

 - call platform SDK

 - handle retries

 - log outbound events

Example:
```
ReplyTextAction → sendMessage
ModerationAction → groupMute
```

# 12. Conversation state

Responsible module:

`assistant-ai`

Conversation state tracks:
```
slot filling
tool workflows
temporary memory
conversation context
```

State must be stored in:

`Redis`

Example:

`conversation:<userId>`

TTL recommended:

`5–30 minutes`

# 13. Observability pipeline

Responsible module:

`modules/observability`

Responsibilities:
```
command logging
message metrics
AI usage metrics
moderation metrics
system heartbeat
```

Metrics examples:
```
messages_total
commands_total
ai_requests_total
reminders_created
moderation_actions
```

# 14. Performance guidelines

To maintain low latency:

Avoid:
```
blocking I/O in pipeline
heavy synchronous computation
large prompt generation
```

Preferred practices:
```
fast command parsing
cached identity lookup
Redis conversation state
async external calls
queue long tasks
```

Target response time:
```
command response < 150ms
AI response < 2 seconds
```

# 15. Failure handling

Each stage must fail safely.

Examples:
```
LLM failure → fallback response
queue failure → retry
database failure → safe error message
```

The assistant must never crash the pipeline.

# 16. Multi-platform expansion

Future gateways may include:

Telegram
Discord
Slack
Web chat

All gateways must produce the same:

InboundMessage

So the pipeline remains unchanged.

# 17. System evolution rules

Future refactoring must preserve:
```
clear stage boundaries
port-based integrations
module isolation
registry-driven commands
AI as optional capability
```

No new feature should bypass the pipeline.

# 18. Long-term architecture goal

Zappy Assistant aims to become:
```
multi-platform conversational assistant
automation orchestrator
AI-powered command system
integration hub
```

The pipeline defined in this blueprint must remain the central execution model.