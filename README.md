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
- `BOT_PREFIX` (default `/`) is the global command prefix; parsing/help text respect this value.
- `INBOUND_MAX_MESSAGE_AGE_SECONDS` (default `30`) discards stale backlog messages on reconnect/new instance before command/AI processing. If timestamp is unavailable, message is accepted (safe fallback) and logged at debug level.
- `STICKER_MAX_VIDEO_SECONDS` (default `10`) limits short-video sticker generation; videos above this threshold are rejected with friendly feedback.
- Operational reactions are configurable via `WA_REACTIONS_ENABLED`, `WA_REACTION_PROGRESS`, `WA_REACTION_SUCCESS`, `WA_REACTION_FAILURE` (defaults: `⏱️`, `✅`, `❌`).
- Audio STT-first capability is controlled by `AUDIO_CAPABILITY_ENABLED`, `AUDIO_AUTO_TRANSCRIBE_ENABLED`, `AUDIO_STT_MODEL`, `AUDIO_STT_TIMEOUT_MS`, `AUDIO_MAX_DURATION_SECONDS`, `AUDIO_MAX_BYTES`, `AUDIO_STT_LANGUAGE`.
- Audio dynamic command dispatch is controlled by `AUDIO_COMMAND_DISPATCH_ENABLED`, `AUDIO_COMMAND_ALLOWLIST`, `AUDIO_COMMAND_MIN_CONFIDENCE`, `AUDIO_TRANSCRIPT_PREVIEW_CHARS`.
- Internal worker -> gateway delivery uses `WA_GATEWAY_INTERNAL_BASE_URL`, `WA_GATEWAY_INTERNAL_PORT`, and `WA_GATEWAY_INTERNAL_TOKEN`.
- Consent config: `CONSENT_TERMS_VERSION`, `CONSENT_LINK`, `CONSENT_SOURCE` drive the onboarding/legal prompt for common users.

## Run

Preferred flow (handles infra + banner + prefixed logs):

```bash
npm run start:dev
```

What it does:
- checks Docker/Compose availability
- ensures `postgres` and `redis` from `infra/docker-compose.yml` are running (starts them if needed)
- waits for connectivity on 5432/6379
- prints a compact cfonts banner (creator/company/version/env/timezone/LLM model/WA session path)
- starts `assistant-api`, `wa-gateway`, `worker`, `admin-ui` in watch mode with prefixed logs and suppresses per-service banners
- writes state to `.zappy-dev/dev-stack.json` so the stop script can cleanly shut things down

Production flow (no watch mode, stable bootstrap):

```bash
npm run start:prod
```

What it does in `prod`:
- checks/starts infra (`postgres`, `redis`) and waits for ports
- runs `npm run build` before bootstrapping services
- starts `assistant-api`, `wa-gateway`, `worker`, `admin-ui` with `npm run start -w ...`
- writes state to `.zappy-dev/prod-stack.json`

Stop services while keeping infra up:

```bash
npm run stop:dev
```

```bash
npm run stop:prod
```

Stop services **and** infra (postgres/redis):

```bash
npm run stop:dev -- --with-infra
```

```bash
npm run stop:prod -- --with-infra
```

If you still prefer the old behavior, `npm run dev` remains available (it will print each service banner).

Manual steps that remain:
- keep `.env` up to date and run `npm run prisma:migrate` when schema changes
- WhatsApp pairing (see below) still requires manual code entry

Version note: dev tooling banner reports `beta 1.0`; expect minor changes while the flow stabilizes.

## Pairing WhatsApp (wa-gateway)

1. Set `WA_PAIRING_PHONE` with country code (e.g. `5511999999999`) and start gateway.
2. Gateway logs a pairing code (`pairing code`) for multi-device login.
3. In WhatsApp: Linked devices -> Link with phone number -> enter code.
4. Session credentials persist in `WA_SESSION_PATH` (default `.wa_auth`).

If `ONLY_GROUP_ID` is set, gateway processes only that group; otherwise it auto-registers groups/users under a default tenant.

## Features

- Core orchestrator pipeline: flags -> triggers -> commands -> LLM fallback.
- Commands: `/help`, `/task add/list/done`, `/note add/list/rm`, `/agenda`, `/calc`, `/timer`, `/mute <duration|off>`, `/whoami`, `/status`, `/reminder in/at`, `/sticker` (`/s`, `/stk`, `/fig`), `/toimg`, `/rnfig`, `/transcribe`.
- Stickers capability:
  - `/sticker` gera figurinha a partir de imagem ou vídeo curto (resposta ou legenda), com ajuste `contain` (sem crop) e padding transparente.
  - `/toimg` funciona apenas respondendo uma figurinha válida.
  - `/rnfig Autor|Pacote` atualiza apenas metadados EXIF de autor/pacote ao responder uma figurinha.
  - Operações pesadas de sticker disparam reação de progresso (`⏱️`) e conclusão (`✅`/`❌`) na mensagem de origem (best-effort).
  - Limitações atuais: vídeo curto apenas (limitado por `STICKER_MAX_VIDEO_SECONDS`), sem gif avançado, sem editor visual, sem suporte a vídeos longos.
- Audio capability (STT-first):
  - `/transcribe` transcreve áudio ao responder uma mensagem de áudio.
  - Áudio enviado diretamente ao bot pode ser transcrito e roteado para resposta no fluxo existente.
  - Dispatch dinâmico por voz usa estratégia controlada: prefixo explícito (`/`), comando falado `slash|barra <comando>`, ou primeiro token da allowlist (`AUDIO_COMMAND_ALLOWLIST`) com confiança mínima (`AUDIO_COMMAND_MIN_CONFIDENCE`).
  - Em baixa confiança, o bot não executa comando dinâmico e responde com fallback amigável/transcrição curta.
  - Limitações atuais: STT apenas (sem TTS), suporte focado em áudio/PTT e limites rígidos de tamanho/duração para preservar recursos.
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
- Services.NET onboarding/consent gate for common users (SIM/NÃO) with link (`CONSENT_LINK`), pending reminder state, and privileged bypass (creator_root, mother_privileged, owners/admins).
- Relationship-aware personas with resolver:
  - creator_root (`556699064658`) and mother_privileged (`556692283438`) get tailored tone, initiative, and deeper memory; other profiles map to delegated_owner/admin/member/external_contact.
- Natural-language tools: create/update/complete/delete tasks, create/update/delete reminders, add/list notes, get time/settings without slash commands.
- Interactive slot filling with stateful follow-ups and cancel/confirmation for destructive actions.
- Privileged memory windows (creator/mother keep larger short-term context) plus concise profile notes injected into prompts.

## Identity resolution
- Canonical identity tracks `waUserId`, normalized `phoneNumber`, `pnJid` (`@s.whatsapp.net`), `lidJid` (`@lid`), `aliases[]`, `displayName`, `permissionRole`, and `relationshipProfile`.
- Resolution order: `phoneNumber` → `pnJid` → `lidJid` → `waUserId` → `aliases`. Every inbound identifier is merged into the alias set to prevent future mismatches.
- UX guardrail: AI addressing name resolves safely (`displayName` confiável → friendly context name → fallback `você`) and never uses internal role labels as vocative name (`ROOT`, `creator_root`, `bot_admin`, etc.).
- Privileged mapping (by phone/pnJid/lidJid/aliases): `556699064658` → `creator_root` + permission role `ROOT`; `556692283438` → `mother_privileged` + permission role `PRIVILEGED`.
- LID ids differ from phone numbers because WhatsApp obfuscates contact ids; add aliases when mapping a new LID to a known phone to keep profiles aligned.
- Admin/root command to bind aliases when WhatsApp hides the phone number: `/alias link <phoneNumber> <lidJid>` (example: `/alias link 556699064658 70029643092123@lid`). The link is stored, relationshipProfile/permissionRole are recalculated immediately, and duplicate users are merged.

## Logging
- Prod: structured JSON (pino) for ingestion. Dev: pretty, colorized, compact lines grouped by category (`SYSTEM`, `AUTH`, `WA-IN`, `WA-OUT`, `AI`, `HTTP`, `QUEUE`, `DB`, `WARN`, `ERROR`). Set `PRETTY_LOGS=false` to force JSON in dev.
- Local timestamps respect `BOT_TIMEZONE`. `DEBUG=trace` disables noise filtering; `DEBUG=stack` shows stack traces inside WARN/ERROR blocks.
- WA-IN/WA-OUT dev lines: `[HH:MM:SS] [WA-IN] [DIRECT|GROUP] <role> <profile> <phone> -> "preview"` with `action=` for outbound. Structured fields (`waMessageId`, `tenantId`, etc.) stay in the JSON payload.
- Warnings/errors are rendered in a block with source module and a short hint; full stack only when `DEBUG=stack`.
- Baileys low-level sync chatter is silenced in dev unless `DEBUG=trace` is set.
- Replayed old inbound messages are skipped with short log `stale inbound skipped` when age exceeds `INBOUND_MAX_MESSAGE_AGE_SECONDS`.

## Startup banner (dev)
- `npm run start:dev` prints a single cfonts banner (`Zappy Assistant ©`) with metadata: Creator (NZ_Dev©), Company (Services.NET), Version (beta 1.0), Environment, Timezone, LLM/model, WA session path. It sets `ZAPPY_SKIP_SERVICE_BANNER=1` so individual services don't repeat the banner.
- `npm run start:prod` prints a compact runtime header (`mode=prod`) and starts services without watch mode.
- Running a service directly (`npm run dev -w ...`) still shows the per-service startup banner with status hints (Redis/DB/Worker/LLM) and Admin URLs. Status transitions remain logged clearly: WhatsApp CONNECTING/QR READY/CONNECTED/DISCONNECTED, Redis/DB OK|FAIL, Worker OK|FAIL.

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
