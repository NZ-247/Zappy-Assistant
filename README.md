# Zappy Assistant

Monorepo WhatsApp assistant using Hexagonal architecture.

## Setup

```bash
cp .env.example .env
npm install
npm run prisma:generate
```

- `LLM_ENABLED=false` skips the LLM fallback and keeps commands/triggers active.
- `BOT_TIMEZONE` (default `America/Cuiaba`) controls all reminder parsing/formatting.

## Run

```bash
npm run dev
```

## Pairing WhatsApp (wa-gateway)

1. Set `WA_PAIRING_PHONE` with country code (e.g. `5511999999999`) and start gateway.
2. Gateway logs a pairing code (`pairing code`) for multi-device login.
3. In WhatsApp: Linked devices -> Link with phone number -> enter code.
4. Session credentials persist in `WA_SESSION_PATH` (default `.wa_auth`).

If `ONLY_GROUP_ID` is set, gateway processes only that group; otherwise it auto-registers groups/users under a default tenant.

## Features

- Core orchestrator pipeline: flags -> triggers -> commands -> LLM fallback.
- Commands: `/help`, `/task add/list/done`, `/note add/list/rm`, `/agenda`, `/calc`, `/timer`, `/mute <duration|off>`, `/whoami`, `/status`, `/reminder in/at`.
- Reminders:
  - `/reminder in <duration> <message>` where duration accepts `1`, `10m`, `1h40m30s`, `2d`.
  - `/reminder at <DD-MM[-YYYY]> [HH:MM] <message>` uses `BOT_TIMEZONE` and defaults time to `08:00`.
- Notes module (scoped to group or user) with public IDs like `N001` and preview listing.
- Agenda command returns today's tasks + reminders using `BOT_TIMEZONE`.
- Calculator uses a safe expression parser for `/calc <expression>`.
- Timer command schedules short-term timers via BullMQ (`fire-timer` jobs).
- Mute command stores a scoped mute window in Redis; triggers/LLM stay silent while muted.
- Status command aggregates gateway/worker heartbeats, DB/Redis checks, and counts for tasks/reminders/timers.
- Trigger priority, cooldown, template variables.
- Reminder and timer jobs via BullMQ with idempotent worker.
- Admin API + UI for flags, triggers, status, logs, and message feed.
- Relationship-aware personas with resolver:
  - creator_root (`556699064658`) and mother_privileged (`556692283438`) get tailored tone, initiative, and deeper memory; other profiles map to delegated_owner/admin/member/external_contact.
- Natural-language tools: create/update/complete/delete tasks, create/update/delete reminders, add/list notes, get time/settings without slash commands.
- Interactive slot filling with stateful follow-ups and cancel/confirmation for destructive actions.
- Privileged memory windows (creator/mother keep larger short-term context) plus concise profile notes injected into prompts.

## Identity resolution
- Canonical identity tracks `waUserId`, normalized `phoneNumber`, `pnJid` (`@s.whatsapp.net`), `lidJid` (`@lid`), `aliases[]`, `displayName`, `permissionRole`, and `relationshipProfile`.
- Resolution order: `phoneNumber` → `pnJid` → `lidJid` → `waUserId` → `aliases`. Every inbound identifier is merged into the alias set to prevent future mismatches.
- Privileged mapping (by phone/pnJid/lidJid/aliases): `556699064658` → `creator_root` + permission role `ROOT`; `556692283438` → `mother_privileged` + permission role `PRIVILEGED`.
- LID ids differ from phone numbers because WhatsApp obfuscates contact ids; add aliases when mapping a new LID to a known phone to keep profiles aligned.
- Admin/root command to bind aliases when WhatsApp hides the phone number: `/alias link <phoneNumber> <lidJid>` (example: `/alias link 556699064658 70029643092123@lid`). The link is stored, relationshipProfile/permissionRole are recalculated immediately, and duplicate users are merged.

## Logging
- Pino JSON logs include `category`: `SYSTEM`, `WA-IN`, `WA-OUT`, `AI`, `HTTP`, `QUEUE`, `DB`, `WARN`, `ERROR`.
- WA-IN/WA-OUT entries log timestamp, scope (direct/group), `waUserId`, resolved `phoneNumber`, `permissionRole`, `relationshipProfile`, `waMessageId`, media flag, and a short text preview.
- AI entries log model, AI enabled/disabled, tool suggestion (if any), and fallback usage. Errors carry `category: ERROR` with origin ids for traceability.

## Startup banner (dev)
On startup (non-production) each app prints a banner with app name, environment, timezone, LLM enabled/disabled, model, Admin API/UI URLs, and queue name, followed by DB/Redis connection status lines and WhatsApp connection state changes.

## Admin

- API: `http://localhost:3333`
- UI: `http://localhost:8080`
- Use `Authorization: Bearer <ADMIN_API_TOKEN>` for `/admin/*`.

## AI module

- `packages/ai` centralizes persona and prompt builder; OpenAI access stays in adapters.
- Persona `secretary_default`: Alan's digital secretary (friendly, polite, slightly formal, organized, concise, proactive, calm).
- Prompt builder assembles identity, role, tone, operational policies (tool-first, no hallucination), context (scope + role + handoff), tools/modules, datetime/timezone, and output expectations. Memory is included only up to the provided limit.
- LLM is optional (`LLM_ENABLED=false` keeps commands/triggers only). See `packages/ai/README.md` for examples of direct vs group prompts.
- AI memory: `ConversationMemory` stores trimmed, AI-relevant turns (default window `LLM_MEMORY_MESSAGES=10`; creator_root uses 24, mother_privileged 18) separate from raw `Message` logs; older items are trimmed automatically.
- AI responses: `AiTextReply`, `AiToolIntent` (suggested tool actions: create/list task/reminder, add/list note, get_time, get_settings), `AiFallback`. Orchestrator receives tool suggestions but decides whether to execute or just reply.
- Relationship-aware persona modifiers adjust tone/initiative/creativity based on profile; internal guardrails prevent leaking this framing to other users.

### Smoke checklist
1. Creator user (`556699064658`) sends a message → recognized as `creator_root`/`ROOT` (check `/whoami` and logs for phone/profile).
2. Mother user (`556692283438`) sends a message → recognized as `mother_privileged` with privileged tone.
3. Same person appears as LID then PN → add alias for the LID, subsequent messages resolve to the same profile/permissions (no duplicate users).
4. Logs show normalized identity info: categories `WA-IN`/`WA-OUT` with phone + relationship profile and message preview.
5. LLM disabled: `LLM_ENABLED=false`, ask a question → graceful fallback text.
6. LLM enabled: ask a general question → text reply.
7. Intent: “Me lembre de pagar o boleto amanhã” → tool intent `create_reminder` suggested.
8. Group chat: ask a short question → concise reply with context.

## Examples
- Creator (556699064658): “Preciso de um plano para o lançamento.” → proactive, strategic outline + suggested next actions.
- Mother (556692283438): “Me lembra de tomar o remédio às 20h.” → gentle confirmation using soft address and schedules the reminder.
- Regular member: “cria uma tarefa para ligar para o cliente amanhã” → parses intent, asks for missing time if needed, then creates the task.
