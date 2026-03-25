# Changelog

## V1.5.0 - 2026-03-25
- Hardened startup/dependency resilience for production runtime:
  - deterministic dependency checks (Docker state + health + TCP connectivity)
  - automatic dependency recovery (`docker compose up -d <service>`) with bounded revalidation
  - clear dependency-failure diagnostics in logs
- Added restart supervisor scripts: `restart:dev`, `restart:prod`, `restart:debug`.
- Added Docker infra hardening in `infra/docker-compose.yml`:
  - `restart: unless-stopped` for `postgres` and `redis`
  - healthchecks for `postgres` and `redis`
  - app service `depends_on` with `service_healthy` for infra dependencies
- Updated runtime/deploy documentation for resilient startup flow.

## V1.4.0 - 2026-03-25
- Added modular downloads capability (`/dl`) with provider routing layer.
- Added provider-separated adapters (`yt`, `ig`, `fb`, `direct`) with explicit compliance-safe behavior.
- Added shared parser/validation/error normalization for download commands.

## V1.3.0 - 2026-03-25
- Added modular image search capability (`/img`, `/gimage`).
- Added configurable image search providers (`google` + `wikimedia` fallback).
- Added result limiting and readable output formatting.

## V1.2.0 - 2026-03-25
- Added modular web text search capability (`/search`, `/google`).
- Added configurable search providers (`google` + `duckduckgo` fallback).
- Added result limiting and structured output (title/summary/link).

## V1.1.0 - 2026-03-25
- Added modular TTS capability (`/tts`) with parser format:
  - `texto`
  - `texto | idioma`
  - `texto | idioma | voz`
- Added default language/voice config and input validation.
- Added pluggable TTS port with OpenAI adapter and WhatsApp audio outbound action (`reply_audio`).
