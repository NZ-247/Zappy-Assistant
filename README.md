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
- Logging env overrides: `LOG_FORMAT`, `LOG_LEVEL`, `LOG_PRETTY_MODE`, `LOG_COLORIZE`, `LOG_VERBOSE_FIELDS` (runtime mode still applies sane defaults).
- Replay/backlog guard is multi-layered: startup watermark + dedupe claim (`remoteJid + waMessageId`) + stale age guard. Main knobs: `INBOUND_MAX_MESSAGE_AGE_SECONDS` (default `30`), `INBOUND_STARTUP_WATERMARK_TOLERANCE_SECONDS` (default `5`), `INBOUND_MISSING_TIMESTAMP_STARTUP_GRACE_SECONDS` (default `15`), `INBOUND_MESSAGE_CLAIM_TTL_SECONDS` (default `172800`).
- `STICKER_MAX_VIDEO_SECONDS` (default `10`) limits short-video sticker generation; videos above this threshold are rejected with friendly feedback.
- Operational reactions are configurable via `WA_REACTIONS_ENABLED`, `WA_REACTION_PROGRESS`, `WA_REACTION_SUCCESS`, `WA_REACTION_FAILURE` (defaults: `⏱️`, `✅`, `❌`).
- Audio STT-first capability is controlled by `AUDIO_CAPABILITY_ENABLED`, `AUDIO_AUTO_TRANSCRIBE_ENABLED`, `AUDIO_STT_MODEL`, `AUDIO_STT_TIMEOUT_MS`, `AUDIO_MAX_DURATION_SECONDS`, `AUDIO_MAX_BYTES`, `AUDIO_STT_LANGUAGE`.
- Audio dynamic command dispatch is controlled by `AUDIO_COMMAND_DISPATCH_ENABLED`, `AUDIO_COMMAND_ALLOWLIST`, `AUDIO_COMMAND_MIN_CONFIDENCE`, `AUDIO_TRANSCRIPT_PREVIEW_CHARS`.
- TTS is controlled by `TTS_ENABLED`, `TTS_MODEL`, `TTS_TIMEOUT_MS`, `TTS_AUDIO_FORMAT`, `TTS_TRANSLATION_MODEL`, `TTS_TRANSLATION_TIMEOUT_MS`, `TTS_DEFAULT_SOURCE_LANGUAGE`, `TTS_DEFAULT_LANGUAGE`, `TTS_DEFAULT_VOICE`, `TTS_MALE_VOICE`, `TTS_FEMALE_VOICE`, `TTS_MAX_TEXT_CHARS`, `TTS_SEND_AS_PTT`.
- Web search is controlled by `SEARCH_ENABLED`, `SEARCH_PROVIDER`, `SEARCH_MAX_RESULTS`, `SEARCH_TIMEOUT_MS`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` (`GOOGLE_SEARCH_CX` remains supported for backward compatibility).
- AI-assisted web search is controlled by `SEARCH_AI_ENABLED`, `SEARCH_AI_PROVIDER`, `SEARCH_AI_MODEL`, `SEARCH_AI_TIMEOUT_MS`, `SEARCH_AI_MAX_SOURCES`, `GEMINI_API_KEY`, `GEMINI_SEARCH_AI_MODEL`, `GEMINI_SEARCH_GROUNDING_ENABLED`.
- Image search is controlled by `IMAGE_SEARCH_ENABLED`, `IMAGE_SEARCH_PROVIDER`, `IMAGE_SEARCH_MAX_RESULTS`, provider credentials (`PIXABAY_API_KEY`, `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`), optional `OPENVERSE_API_BASE_URL`, and normalization knobs (`IMAGE_SEARCH_MEDIA_NORMALIZE_*`).
- Downloads module is controlled by `DOWNLOADS_MODULE_ENABLED`, `DOWNLOADS_DIRECT_TIMEOUT_MS`.
- Internal worker -> gateway delivery uses `WA_GATEWAY_INTERNAL_BASE_URL`, `WA_GATEWAY_INTERNAL_PORT`, and `WA_GATEWAY_INTERNAL_TOKEN`.
- Consent config: `CONSENT_TERMS_VERSION`, `CONSENT_LINK`, `CONSENT_SOURCE` drive the onboarding/legal prompt for common users.

## Run

Preferred flow for local development:

```bash
npm run start:dev
```

What `start:dev` does:
- checks Docker/Compose availability
- validates infra dependencies (`postgres`, `redis`) with deterministic checks: container state + Docker health + TCP port
- if a required dependency is down/unhealthy, runs `docker compose up -d <service>` automatically and revalidates before boot
- emits structured dependency logs (`[deps] phase=...`) including failing service, attempted action, and final diagnostic
- prints a compact cfonts banner (mode/environment/timezone/LLM model/WA session path)
- starts `assistant-api`, `wa-gateway`, `worker`, `admin-ui` in watch mode with prefixed logs and suppresses per-service banners
- writes state to `.zappy-dev/dev-stack.json` so the stop script can cleanly shut things down

Production flow (no watch mode, stable bootstrap):

```bash
npm run start:prod
```

Build-on-demand before startup:

```bash
npm run start:prod -- --build
```

What it does in `prod`:
- runs the same dependency validation/auto-recovery flow used in dev (state + health + port)
- skips build by default (faster boot)
- runs `npm run build` only when `--build` is passed
- starts `assistant-api`, `wa-gateway`, `worker`, `admin-ui` with `npm run start -w ...`
- writes state to `.zappy-dev/prod-stack.json`
- prints runtime header with `build=executed|skipped`
- forces runtime log defaults: `LOG_FORMAT=pretty`, `LOG_PRETTY_MODE=prod`, `LOG_COLORIZE=true`, `LOG_LEVEL=info`, `LOG_VERBOSE_FIELDS=false` (can still be overridden via env)

Debug flow (technical troubleshooting):

```bash
npm run start:debug
```

What it does in `debug`:
- runs the same dependency validation/auto-recovery flow used in dev/prod
- runs `npm run build` before bootstrapping services
- starts all apps with non-watch runtime (`npm run start -w ...`)
- forces runtime log defaults: `LOG_FORMAT=json`, `LOG_LEVEL=debug`, `LOG_VERBOSE_FIELDS=true`, `DEBUG=trace` (can still be overridden via env)
- writes state to `.zappy-dev/debug-stack.json`

Stop services while keeping infra up:

```bash
npm run stop:dev
```

```bash
npm run stop:prod
```

```bash
npm run stop:debug
```

Stop services **and** infra (postgres/redis):

```bash
npm run stop:dev -- --with-infra
```

```bash
npm run stop:prod -- --with-infra
```

```bash
npm run stop:debug -- --with-infra
```

Restart flows:

```bash
npm run restart:dev
```

```bash
npm run restart:prod -- --build
```

```bash
npm run restart:debug
```

If you still prefer the old behavior, `npm run dev` remains available (it will print each service banner).

Manual steps that remain:
- keep `.env` up to date and run `npm run prisma:migrate` when schema changes
- WhatsApp pairing (see below) still requires manual code entry

Version note: current release line is `v1.5.0`.

## Pairing WhatsApp (wa-gateway)

1. Set `WA_PAIRING_PHONE` with country code (e.g. `5511999999999`) and start gateway.
2. Gateway logs a pairing code (`pairing code`) for multi-device login.
3. In WhatsApp: Linked devices -> Link with phone number -> enter code.
4. Session credentials persist in `WA_SESSION_PATH` (default `.wa_auth`).

If `ONLY_GROUP_ID` is set, gateway processes only that group; otherwise it auto-registers groups/users under a default tenant.

## Features

- Core orchestrator pipeline: flags -> triggers -> commands -> LLM fallback.
- Commands: `/help`, `/task add/list/done`, `/note add/list/rm`, `/agenda`, `/calc`, `/timer`, `/mute <duration|off>`, `/whoami`, `/status`, `/reminder in/at`, `/sticker` (`/s`, `/stk`, `/fig`), `/toimg`, `/rnfig`, `/transcribe` (`/tr`, `/tss`), `/tts`, `/trl`, `/search`, `/google`, `/search-ai` (`/sai`), `/img` (`/gimage`), `/imglink`, `/dl`.
- Stickers capability:
  - `/sticker` gera figurinha a partir de imagem ou vídeo curto (resposta ou legenda), com ajuste `contain` (sem crop) e padding transparente.
  - `/toimg` funciona apenas respondendo uma figurinha válida.
  - `/rnfig Autor|Pacote` atualiza apenas metadados EXIF de autor/pacote ao responder uma figurinha.
  - Operações pesadas de sticker disparam reação de progresso (`⏱️`) e conclusão (`✅`/`❌`) na mensagem de origem (best-effort).
  - Limitações atuais: vídeo curto apenas (limitado por `STICKER_MAX_VIDEO_SECONDS`), sem gif avançado, sem editor visual, sem suporte a vídeos longos.
- Audio capability (STT-first):
  - `/transcribe` (alias `/tss`) transcreve áudio ao responder uma mensagem de áudio.
  - Áudio enviado diretamente ao bot pode ser transcrito e roteado para resposta no fluxo existente.
  - Dispatch dinâmico por voz usa estratégia controlada: prefixo explícito (`/`), comando falado `slash|barra <comando>`, ou primeiro token da allowlist (`AUDIO_COMMAND_ALLOWLIST`) com confiança mínima (`AUDIO_COMMAND_MIN_CONFIDENCE`).
  - Em baixa confiança, o bot não executa comando dinâmico e responde com fallback amigável/transcrição curta.
- TTS module:
  - `/tts <texto>` usa origem/destino/voz padrão (`TTS_DEFAULT_SOURCE_LANGUAGE`, `TTS_DEFAULT_LANGUAGE`, `TTS_DEFAULT_VOICE`).
  - Formato compatível: `/tts <texto> |<destino>|<voz>` (ex: `/tts Bom dia |en|female`).
  - Formato explícito origem->destino: `/tts <texto> |<origem>|<destino>|<voz>` (ex: `/tts Bom dia |pt-BR|en|female`).
  - Também aceita uso por resposta: responda um texto e envie `/tts` (ou `/tts |<destino>|<voz>`).
  - Quando origem e destino diferem, o texto é traduzido antes da síntese; se a tradução falhar, o áudio não é gerado.
  - Saída padrão como voice note/PTT (`TTS_SEND_AS_PTT=true`) com recodificação final para `OGG/Opus` no gateway (mimetype final `audio/ogg; codecs=opus`).
  - Limitações: qualidade de tradução depende do provider/model configurado; textos muito longos respeitam `TTS_MAX_TEXT_CHARS`; para PTT 100% compatível o host deve ter `ffmpeg` disponível (sem isso o gateway faz fallback para áudio comum).
- Translation module:
  - `/trl <texto>` traduz com detecção automática de idioma e saída curta para WhatsApp.
  - Alvo padrão: origem `pt*` -> `en`; demais origens -> `pt`.
  - Override de alvo: `/trl <texto> |<destino>` (ex: `/trl Olá |en`).
  - Também aceita uso por resposta: responda um texto e envie `/trl`.
  - Resposta a áudio também é suportada: responda um áudio e envie `/trl` (ou `/trl |<destino>`); o fluxo interno transcreve e depois traduz.
- Web search module:
  - `/search <termo>` executa busca textual genérica (provider preferido em `SEARCH_PROVIDER` com fallback automático) e aceita termo via resposta.
  - `/google <termo>` usa Google Programmable Search real (sem cair silenciosamente no mesmo fluxo de `/search`) e aceita termo via resposta.
  - Quantidade de resultados controlada por `SEARCH_MAX_RESULTS`.
  - Provider configurável (`SEARCH_PROVIDER`) com fallback para DuckDuckGo no comando `/search`.
  - `/google` depende de `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` (ou `GOOGLE_SEARCH_CX` legado); se faltar configuração, retorna aviso amigável.
  - Limitações: sem síntese semântica de múltiplas fontes (para isso, use `/search-ai`).
- AI-assisted web search module:
  - `/search-ai <termo>` e `/sai <termo>` executam busca assistida por IA com acesso à internet e aceitam termo via resposta.
  - Retorna resposta resumida + principais fontes/links.
  - Provider selecionável por `SEARCH_AI_PROVIDER` (`openai` ou `gemini`).
  - Para `gemini`, habilite `GEMINI_API_KEY` e mantenha `GEMINI_SEARCH_GROUNDING_ENABLED=true` para grounding com Google Search.
  - Limitações: depende de modelo com suporte a web tool/grounding; falhas de quota/permissão do provider podem indisponibilizar o recurso.
- Image search module:
  - `/img <termo>` e `/gimage <termo>` priorizam resultado visual relevante, com variabilidade controlada para evitar repetição excessiva no mesmo termo.
  - `/imglink <termo>` usa a mesma busca e retorna fallback conciso em linha curta com link útil.
  - Ambos aceitam termo via resposta a mensagem de texto.
  - Legenda/retorno segue formato curto: descrição breve (quando útil) + uma fonte.
  - Quantidade de resultados controlada por `IMAGE_SEARCH_MAX_RESULTS`.
  - Estratégia nativa-first: Wikimedia Commons -> Openverse -> Pixabay -> Pexels -> Unsplash; Google CSE entra apenas como fallback de descoberta.
  - Política de qualidade de domínio: prioriza fontes confiáveis e exclui Pinterest/Behance/Dribbble/ArtStation/DeviantArt do pipeline `/img`.
  - O adapter valida e normaliza mídia (resize/re-encode JPEG/PNG quando necessário) para melhorar entregabilidade no WhatsApp.
- Downloads module (provider router):
  - `/dl <link>` tenta detectar provider automaticamente e enviar mídia de forma compacta.
  - `/dl ig <link instagram público>` suporta `instagram.com/p/...`, `.../reel/...` e `.../tv/...` com fallback seguro para privado/login-required.
  - `/dl direct <link>` mantém validação de link direto (http/https), tipo de mídia e metadados básicos.
  - `/dl yt|fb <link>` continua com resposta explícita de bloqueio por compliance/permissão.
  - Parsing, validação, roteamento e tratamento de erro padronizados em módulo dedicado.
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
- Runtime defaults by mode:
  - `dev`: pretty + detailed (`LOG_FORMAT=pretty`, `LOG_PRETTY_MODE=dev`, `LOG_COLORIZE=true`, `LOG_LEVEL=debug`, `LOG_VERBOSE_FIELDS=true`)
  - `prod`: pretty + operational one-line output (`LOG_FORMAT=pretty`, `LOG_PRETTY_MODE=prod`, `LOG_COLORIZE=true`, `LOG_LEVEL=info`, `LOG_VERBOSE_FIELDS=false`)
  - `debug`: raw/json + max technical detail (`LOG_FORMAT=json`, `LOG_LEVEL=debug`, `LOG_VERBOSE_FIELDS=true`, `DEBUG=trace`)
- Configurable env knobs:
  - `LOG_FORMAT=pretty|json`
  - `LOG_LEVEL=fatal|error|warn|info|debug|trace|silent`
  - `LOG_PRETTY_MODE=dev|prod`
  - `LOG_COLORIZE=true|false` (default follows mode/supervisor; `NO_COLOR` disables)
  - `LOG_VERBOSE_FIELDS=true|false`
- Backward compatibility: `PRETTY_LOGS=false` still forces JSON when `LOG_FORMAT` is not explicitly set.
- Local timestamps respect `BOT_TIMEZONE`. `DEBUG=trace` disables Baileys noise filtering; `DEBUG=stack` shows stack traces in pretty WARN/ERROR blocks.
- Pretty output keeps category-first lines (`SYSTEM`, `AUTH`, `WA-IN`, `WA-OUT`, `AI`, `HTTP`, `QUEUE`, `DB`, `WARN`, `ERROR`, `COMMAND_TRACE`), includes source tag (`[wa-gateway]`, `[worker]`, etc.), and preserves key traceability fields (`msg`, `in`, `exec`, `resp`) when present.
- In `prod` pretty profile, each event is rendered as a clean single line.
- Replay drops are explicit and auditable: `stale inbound skipped`, `replay/backlog inbound skipped` (startup watermark), and `duplicate inbound message skipped` (dedupe claim hit).

## Startup banner (dev)
- `npm run start:dev` prints a single cfonts banner (`Zappy Assistant ©`) with runtime metadata and runs all services in watch mode.
- `npm run start:prod` prints a compact runtime header (`mode=prod`, `build=...`) and starts services without watch mode (clean operational output, no dev branding per service).
- `npm run start:debug` prints a compact runtime header (`mode=debug`) and starts services without watch mode using raw/json logging for deep troubleshooting.
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
