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
- Commands: `/help`, `/task add/list/done`, `/reminder in/at`.
- Reminders:
  - `/reminder in <duration> <message>` where duration accepts `1`, `10m`, `1h40m30s`, `2d`.
  - `/reminder at <DD-MM[-YYYY]> [HH:MM] <message>` uses `BOT_TIMEZONE` and defaults time to `08:00`.
- Trigger priority, cooldown, template variables.
- Reminder jobs via BullMQ with idempotent worker.
- Admin API + UI for flags, triggers, status, logs, and message feed.

## Admin

- API: `http://localhost:3333`
- UI: `http://localhost:8080`
- Use `Authorization: Bearer <ADMIN_API_TOKEN>` for `/admin/*`.
