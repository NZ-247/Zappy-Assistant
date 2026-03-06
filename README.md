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

## Admin

- API: `http://localhost:3333`
- UI: `http://localhost:8080`
- Use `Authorization: Bearer <ADMIN_API_TOKEN>` for `/admin/*`.

## AI module

- `packages/ai` centralizes persona and prompt builder; OpenAI access stays in adapters.
- Persona `secretary_default`: Alan's digital secretary (friendly, polite, slightly formal, organized, concise, proactive, calm).
- Prompt builder assembles identity, role, tone, operational policies (tool-first, no hallucination), context (scope + role + handoff), tools/modules, datetime/timezone, and output expectations. Memory is included only up to the provided limit.
- LLM is optional (`LLM_ENABLED=false` keeps commands/triggers only). See `packages/ai/README.md` for examples of direct vs group prompts.
- AI memory: `ConversationMemory` stores trimmed, AI-relevant turns (default window `LLM_MEMORY_MESSAGES=10`) separate from raw `Message` logs; older items are trimmed automatically.
- AI responses: `AiTextReply`, `AiToolIntent` (suggested tool actions: create/list task/reminder, add/list note, get_time, get_settings), `AiFallback`. Orchestrator receives tool suggestions but decides whether to execute or just reply.

### Manual AI smoke checklist
- LLM disabled: `LLM_ENABLED=false`, ask a question → graceful fallback text.
- LLM enabled text: ask a general question → text reply.
- Intent: “Me lembre de pagar o boleto amanhã” → tool intent `create_reminder` suggested.
- Group chat: ask a short question → concise reply with context.
