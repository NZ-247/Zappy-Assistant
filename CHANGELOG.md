# Changelog

## V1.6.3 - 2026-04-14
- Added a dedicated control-plane app `apps/admin-api` with versioned admin routes under `/admin/v1/*`.
- Added persisted governance/admin entities to Prisma:
  - `UserAccess`
  - `GroupAccess`
  - `LicensePlan`
  - `UsageCounter`
  - `ApprovalAudit`
- Added admin authentication guard improvements for control-plane routes (`Authorization: Bearer` + `x-admin-token` fallback).
- Added v1 admin endpoints for approvals, licenses, usage visibility, and approval audit trail:
  - `GET /admin/v1/users`
  - `GET /admin/v1/users/:waUserId`
  - `PATCH /admin/v1/users/:waUserId/access`
  - `GET /admin/v1/groups`
  - `GET /admin/v1/groups/:waGroupId`
  - `PATCH /admin/v1/groups/:waGroupId/access`
  - `GET /admin/v1/licenses/plans`
  - `PATCH /admin/v1/users/:waUserId/license`
  - `PATCH /admin/v1/groups/:waGroupId/license`
  - `GET /admin/v1/usage/users/:waUserId`
  - `GET /admin/v1/usage/groups/:waGroupId`
  - `GET /admin/v1/audit`
  - `GET /admin/v1/status`
- Kept compatibility endpoints for existing admin consumers (`/admin/status`, `/admin/flags`, `/admin/triggers`, `/admin/messages`, `/admin/commands`, `/admin/queues`, `/admin/metrics/summary`).
- Refined governance read-only adapter to compose persisted access/tier state alongside transitional sources:
  - first-seen materialization for users/groups with safe defaults (`status=PENDING`, `tier=FREE`)
  - decision placeholders now resolve real approval/licensing snapshot states in shadow mode.
- Updated runtime orchestration to boot `admin-api` as the root admin service on `ADMIN_API_PORT`.
- Added tests for:
  - admin-api route auth and response shape
  - approval/block flow
  - user/group license assignment flow
  - audit trail creation on admin mutations
  - usage endpoint response shape
  - governance adapter persisted approval/tier composition
  - governance decision placeholder mapping from snapshot access state
- Bumped workspace/project versions to `1.6.3`.

## V1.6.2 - 2026-04-12
- Added Governance Foundation (Phase 1, shadow mode) with modular core decision layer:
  - new `packages/core/src/modules/governance/*`
  - `DecisionInput`, `DecisionResult`, reason codes, diagnostics, and `resolveGovernanceDecision`
- Added transitional read-only governance adapter composition in `packages/adapters/src/governance/*`:
  - composes existing feature flags, group settings, bot-admin signals, and consent state
  - no behavioral enforcement yet
- Added Admin read-only governance snapshot endpoint:
  - `GET /admin/v1/governance/snapshot`
  - returns evaluated decision + snapshot payload for debugging/future Admin UI
- Added WA Gateway shadow-mode integration:
  - governance decision is evaluated and logged before normal routing
  - decision is not enforced yet (current runtime behavior unchanged)
- Added structured observability for governance shadow decisions:
  - decision, reason codes, context summary, and explicit `shadowMode=true`
- Added test coverage for:
  - governance use-case outcomes (`core`)
  - read-only governance adapter composition (`adapters`)
  - snapshot endpoint response (`assistant-api`)
  - shadow-mode logging seam (`wa-gateway`)
- Bumped workspace/project versions to `1.6.2`.

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
