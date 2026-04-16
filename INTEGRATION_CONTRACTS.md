General response conventions
Success

JSON object

JSON array

standard HTTP 200/201/204 depending on route

Error

Current minimal format:

{ "error": "Unauthorized" }

Future-friendly richer shape may evolve to:

{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Unauthorized"
  }
}

UI generators should be tolerant to current and future enriched error formats.

3. Admin API endpoints
3.1 GET /admin/status
Purpose

Operational status of the system.

Expected fields

Example shape:

{
  "gateway": {
    "online": true,
    "lastHeartbeatAt": "2026-03-11T12:00:00.000Z",
    "ageSeconds": 4,
    "botConnectionState": "connected"
  },
  "worker": {
    "online": true,
    "lastHeartbeatAt": "2026-03-11T12:00:02.000Z",
    "ageSeconds": 2
  },
  "db": {
    "ok": true
  },
  "redis": {
    "ok": true
  },
  "llm": {
    "enabled": true,
    "model": "gpt-4o-mini"
  },
  "queues": {
    "reminders": {
      "waiting": 0,
      "active": 0,
      "completed": 12,
      "failed": 1,
      "delayed": 2
    }
  }
}
UI use

status cards

health badges

heartbeat age indicators

queue summary tiles

3.2 GET /admin/queues
Purpose

Detailed queue/job metrics.

Expected fields

Example shape:

{
  "queues": [
    {
      "name": "reminders",
      "waiting": 0,
      "active": 0,
      "completed": 12,
      "failed": 1,
      "delayed": 2
    }
  ]
}
UI use

queue table

queue cards

failed jobs alert

3.3 GET /admin/metrics/summary
Purpose

High-level counters for system usage.

Expected fields

Example shape:

{
  "messages_received_total": 120,
  "commands_executed_total": 48,
  "trigger_matches_total": 12,
  "ai_requests_total": 33,
  "ai_failures_total": 2,
  "reminders_created_total": 8,
  "reminders_sent_total": 6,
  "moderation_actions_total": 5,
  "onboarding_pending_total": 3,
  "onboarding_accepted_total": 10
}
UI use

dashboard cards

trend widgets later

usage summary

3.4 GET /admin/commands
Purpose

Recent command audit feed.

Query params

limit optional

Example:

GET /admin/commands?limit=50
Expected fields

Example item:

{
  "id": "clg_123",
  "tenantId": "tenant_1",
  "conversationId": "conv_1",
  "waUserId": "556699064658@s.whatsapp.net",
  "command": "/set gp rules",
  "inputText": "/set gp rules Proibido spam",
  "resultSummary": "Rules updated",
  "status": "success",
  "createdAt": "2026-03-11T12:10:00.000Z"
}
UI use

commands table

audit history

filters by status or command

3.5 GET /admin/messages
Purpose

Recent message feed.

Query params

limit optional

Example:

GET /admin/messages?limit=50
Expected fields

Example item:

{
  "id": "msg_123",
  "direction": "inbound",
  "waUserId": "556699064658@s.whatsapp.net",
  "groupId": "120363426095846827@g.us",
  "textPreview": "/help",
  "messageType": "conversation",
  "createdAt": "2026-03-11T12:12:00.000Z"
}
UI use

message feed

conversation diagnostics

recent activity panel

3.6 GET /admin/v1/governance/snapshot
Purpose

Read-only governance evaluation snapshot for a requested subject/context.

Notes

Runtime-aware snapshot in v1.8.0:

decision is evaluated and returned for observability/debugging

this endpoint remains read-only (no side-effecting runtime enforcement action is applied here)

Governance subject strategy (v1.8.1+):

- `scope=private` resolves policy primarily against user access/policy.
- `scope=group` resolves policy primarily against group access/policy.
- user checks in group scope are secondary/exceptional (explicit user deny, admin/elevated role checks).

Required query params

tenantId

waUserId

Optional query params

waGroupId, scope, capability, route, routeKey, commandName, requiredRole

requiresBotAdmin, requiresGroupAdmin, senderIsGroupAdmin

botIsGroupAdmin, botAdminCheckFailed, botAdminStatusSource

permissionRole, relationshipProfile

consentStatus, consentRequired, consentBypass, termsVersion

messageKind, rawMessageType, ingressSource, isBotMentioned, isReplyToBot

Example

GET /admin/v1/governance/snapshot?tenantId=t1&waUserId=5511999999999@s.whatsapp.net&waGroupId=1203@g.us&scope=group&capability=command.hidetag&requiresBotAdmin=true

Example response shape

{
  "schemaVersion": "governance.snapshot.v1",
  "governanceVersion": "v1.8.0",
  "shadowMode": false,
  "input": {
    "tenant": { "id": "t1" },
    "user": { "waUserId": "5511999999999@s.whatsapp.net" },
    "context": { "scope": "group", "isGroup": true, "routeKey": "admin.snapshot" },
    "request": { "capability": "command.hidetag", "requiresBotAdmin": true }
  },
  "decision": {
    "decision": "allow",
    "allow": true,
    "blockedByPolicy": false,
    "blocked_by_policy": false,
    "reasonCodes": ["ALLOW_POLICY_PASSED"],
    "allowedCapabilities": ["conversation.direct", "conversation.group"]
  }
}

UI use

governance debug panel

policy diagnostics view

future admin-ui governance screen foundation

3.7 Admin Governance Persistence Endpoints (v1.7.0)

Purpose

Expose persisted approvals, license tiers, usage visibility, and administrative audit trail.

Endpoints

Users

- `GET /admin/v1/users`
- `GET /admin/v1/users/:waUserId`
- `PATCH /admin/v1/users/:waUserId/access`

User access payload extensions (v1.8.1+):

- `permissionRole` (string | null)
- `authorityRole` (`MEMBER | ADMIN | ROOT`)
- `isBotAdmin` (boolean)

Groups

- `GET /admin/v1/groups`
- `GET /admin/v1/groups/:waGroupId`
- `PATCH /admin/v1/groups/:waGroupId/access`

Licenses

- `GET /admin/v1/licenses/plans`
- `PATCH /admin/v1/users/:waUserId/license`
- `PATCH /admin/v1/groups/:waGroupId/license`

Usage

- `GET /admin/v1/usage/users/:waUserId`
- `GET /admin/v1/usage/groups/:waGroupId`

Audit

- `GET /admin/v1/audit`

Default materialization policy

- first-seen private users are materialized with `status=PENDING`, `tier=FREE`
- first-seen groups are materialized with `status=PENDING`, `tier=FREE`
- admin mutation endpoints append records to `ApprovalAudit`

3.8 Admin Jobs/Status Extensions (v1.7.0)

Purpose

Support the Admin UI MVP dashboard and jobs/reminders operations without moving policy/business logic to frontend.

Endpoints

- `GET /admin/v1/status` (schema `admin.status.v2`)
- `GET /admin/v1/reminders`
- `POST /admin/v1/reminders/:reminderId/retry`

Status (`admin.status.v2`) notable fields

- `projectVersion`
- `services.gateway|worker|adminApi|mediaResolverApi|assistantApi`
- `db`, `redis`, `llm`
- `queue`
- `reminders` summary
- `resolver` summary
- `failures` summary (`queueFailedJobs`, `failedReminders`, `recentFailedReminders`)
- `warnings` (degraded dependencies / stale heartbeat / partial availability)

Reminder retry policy

- retry endpoint is safe and restricted to reminders currently in `FAILED`
- successful retry re-schedules the reminder and enqueues `send-reminder`
- invalid-state retries return conflict (`409`)

3.9 Governance Capability Policy Endpoints (v1.8.0)

Purpose

Expose first-class capability policy controls (catalog, bundles, overrides, effective resolution) while keeping policy decisions in core.

Endpoints

Catalog

- `GET /admin/v1/governance/capabilities`
- `GET /admin/v1/governance/bundles`

Effective policy views

- `GET /admin/v1/governance/users/:waUserId/effective`
- `GET /admin/v1/governance/groups/:waGroupId/effective`

Bundle mutations

- `PUT /admin/v1/governance/users/:waUserId/bundles/:bundleKey`
- `DELETE /admin/v1/governance/users/:waUserId/bundles/:bundleKey`
- `PUT /admin/v1/governance/groups/:waGroupId/bundles/:bundleKey`
- `DELETE /admin/v1/governance/groups/:waGroupId/bundles/:bundleKey`

Capability override mutations

- `PUT /admin/v1/governance/users/:waUserId/capabilities/:capabilityKey` body: `{ "mode": "allow" | "deny", "actor"?, "tenantId"? }`
- `DELETE /admin/v1/governance/users/:waUserId/capabilities/:capabilityKey`
- `PUT /admin/v1/governance/groups/:waGroupId/capabilities/:capabilityKey` body: `{ "mode": "allow" | "deny", "actor"?, "tenantId"? }`
- `DELETE /admin/v1/governance/groups/:waGroupId/capabilities/:capabilityKey`

Effective policy response shape (summary)

- subject metadata (`tenantId`, `subjectType`, `subjectId`, `tier`, `status`)
- assigned bundles (`assignedBundles.user`, `assignedBundles.group`)
- explicit overrides (`overrides.user`, `overrides.group`)
- `effectiveCapabilities[]` with:
  - `key`, `allow`
  - `source` (`tier_default` | `bundle` | `user_override_allow` | `group_override_allow` | `none`)
  - `denySource` (`tier_default` | `missing_bundle` | `explicit_override_deny` | `blocked_status` | `quota_denied` | `policy_flag` | `unknown` | `null`)
  - `tierDefaultAllowed`, `bundleAllowed`, `matchedBundles`, `explicitAllowSource`, `explicitDenySources`

4. UI page mapping (Admin UI MVP v1.7.0)
4.1 Dashboard page

Uses:

- `/admin/v1/status`

- `/admin/metrics/summary`

Widgets:

service cards for wa-gateway, worker, admin-api, media-resolver-api, assistant-api (optional)

infra cards for postgres/redis

current project version

resolver health summary

jobs/reminders summary

recent failure/warning summary

4.2 Users page

Uses:

- `GET /admin/v1/users`
- `PATCH /admin/v1/users/:waUserId/access`
- `PATCH /admin/v1/users/:waUserId/license`
- `GET /admin/v1/usage/users/:waUserId` (details/usage panel)
- `GET /admin/v1/governance/users/:waUserId/effective` (details/policy panel)
- `PUT|DELETE /admin/v1/governance/users/:waUserId/bundles/:bundleKey`
- `PUT|DELETE /admin/v1/governance/users/:waUserId/capabilities/:capabilityKey`

Widgets:

list + search/filter

status badge (`PENDING|APPROVED|BLOCKED`)

tier badge (`FREE|BASIC|PRO|ROOT`)

actions: approve / block / change tier / assign-remove bundle / set-clear capability override

optional detail panel/modal

4.3 Groups page

Uses:

- `GET /admin/v1/groups`
- `PATCH /admin/v1/groups/:waGroupId/access`
- `PATCH /admin/v1/groups/:waGroupId/license`
- `GET /admin/v1/usage/groups/:waGroupId` (details/usage panel)
- `GET /admin/v1/governance/groups/:waGroupId/effective` (details/policy panel)
- `PUT|DELETE /admin/v1/governance/groups/:waGroupId/bundles/:bundleKey`
- `PUT|DELETE /admin/v1/governance/groups/:waGroupId/capabilities/:capabilityKey`

Widgets:

list + search/filter

status badge

tier badge

actions: approve / block / change tier / assign-remove bundle / set-clear capability override

4.4 Licenses/Plans page

Uses:

- `GET /admin/v1/licenses/plans`

Widgets:

tier cards/table

plan metadata (`displayName`, `description`, `active`, capability defaults)

4.5 Audit page

Uses:

- `GET /admin/v1/audit`

Widgets:

actor, timestamp, subject, action

before/after summary where available

subject filters where practical

4.6 Jobs/Reminders page

Uses:

- `GET /admin/v1/reminders`
- `POST /admin/v1/reminders/:reminderId/retry`

Widgets:

reminder/job list

status filters

failed reminder inspection

retry action when status is `FAILED`

5. UI state requirements

Every UI implementation should support:

Loading state

skeleton or spinner

Empty state

Examples:

no commands yet

no messages yet

no queues configured

no users/groups/reminders/plans/audit records

Error state

Examples:

unauthorized

network or upstream unavailable

backend unavailable

partial backend availability (degraded services)

Offline state

Useful when:

gateway heartbeat stale

worker heartbeat stale

6. Current important env/config concepts

UI/builders may need to reflect or display:

BOT_PREFIX

BOT_NAME

BOT_TIMEZONE

ADMIN_API_PORT

ADMIN_UI_PORT

ADMIN_API_BASE_URL

ASSISTANT_API_BASE_URL (optional, for dashboard aggregation)

LLM_ENABLED

OPENAI_MODEL

Not all need dedicated endpoints immediately, but these are relevant system settings.

7. Future contract areas

Potential future endpoints/pages:

group settings

tasks list

onboarding statuses

moderation actions

role/access administration

command registry metadata

feature flags / fun mode / downloads mode

8. Guidance for external code generators

If generating UI or integration code in Lovable, Cody, or similar tools:

treat Admin API as the source of truth

do not invent fields not documented here

handle missing/optional fields gracefully

assume auth is Bearer token

separate data access layer from presentation layer

do not embed business rules in UI code

9. Contract stability policy

This document should be updated whenever:

new admin endpoints are added

payload shape changes

new pages depend on new fields

auth/error shape changes

It is the integration-facing reference document for external builders and UI generation tools.

## 10. `.env.example` alignment

The shared `.env.example` now carries the command prefix by default:

```env
BOT_NAME=Zappy
BOT_PREFIX=/
BOT_TIMEZONE=America/Cuiaba
```

## 11. Internal Worker -> WA Gateway contract

Purpose

Worker jobs (`send-reminder`, `fire-timer`) must send text through the real WhatsApp socket owned by `wa-gateway`.

Route

`POST /internal/messages/text`

Auth

`Authorization: Bearer <WA_GATEWAY_INTERNAL_TOKEN>`

Request shape

```json
{
  "tenantId": "tenant_1",
  "to": "556699064658@s.whatsapp.net",
  "text": "⏰ Lembrete: pagar boleto",
  "action": "send_reminder",
  "referenceId": "RMD001",
  "waUserId": "556699064658@lid",
  "waGroupId": null
}
```

`action` supports:

- `send_reminder`
- `fire_timer`

Success response

```json
{
  "ok": true,
  "waMessageId": "BAE5A9F4D0B...",
  "raw": {}
}
```

Failure response (minimal)

```json
{
  "ok": false,
  "error": "Dispatch failed",
  "code": "DISPATCH_FAILED"
}
```

Relevant env vars

- `WA_GATEWAY_INTERNAL_PORT` (gateway listener port)
- `WA_GATEWAY_INTERNAL_BASE_URL` (worker target base URL)
- `WA_GATEWAY_INTERNAL_TOKEN` (shared bearer token)

## 12. Internal `/dl` media resolver contract

Purpose

`wa-gateway` delegates `/dl` resolution to `media-resolver-api` so provider-specific detection/probe/download/normalization stays outside gateway runtime.

Route

`POST /internal/media/resolve`

Auth

`Authorization: Bearer <MEDIA_RESOLVER_API_TOKEN>`

Request shape

```json
{
  "provider": "ig",
  "url": "https://www.instagram.com/reel/...",
  "tenantId": "tenant_1",
  "waUserId": "556699064658@s.whatsapp.net",
  "waGroupId": "1203...@g.us",
  "quality": "best",
  "maxBytes": 16777216,
  "idempotencyKey": "dl-<hash>"
}
```

`provider` is optional and supports:

- `yt`
- `ig`
- `fb`
- `direct`

Success response

```json
{
  "ok": true,
  "result": {
    "provider": "ig",
    "detectedProvider": "ig",
    "status": "ready",
    "resultKind": "reel_video",
    "reason": "download_ready",
    "title": "Example title",
    "canonicalUrl": "https://www.instagram.com/reel/...",
    "url": "https://cdn.example/media.mp4",
    "mimeType": "video/mp4",
    "sizeBytes": 1048576,
    "asset": {
      "kind": "video",
      "mimeType": "video/mp4",
      "fileName": "ig-abc123.mp4",
      "directUrl": "https://cdn.example/media.mp4",
      "bufferBase64": "<optional-inline-media>"
    },
    "jobId": "8f0f2f1a-..."
  }
}
```

`status` values:

- `ready`
- `unsupported`
- `blocked`
- `invalid`
- `error`

`resultKind` values:

- `preview_only`
- `image_post`
- `video_post`
- `reel_video`
- `blocked`
- `private`
- `login_required`
- `unsupported`

Failure response (minimal)

```json
{
  "ok": false,
  "error": "Resolve failed",
  "code": "RESOLVE_FAILED"
}
```

Relevant env vars

- `MEDIA_RESOLVER_API_PORT` (resolver listener port)
- `MEDIA_RESOLVER_API_BASE_URL` (gateway target base URL)
- `MEDIA_RESOLVER_API_TOKEN` (shared bearer token)
- `MEDIA_RESOLVER_JOB_TTL_SECONDS` (Redis job metadata TTL)
- `MEDIA_RESOLVER_CLEANUP_INTERVAL_MS` (temp cleanup cadence)
- `MEDIA_RESOLVER_TEMP_DIR` (temp storage directory)
- `MEDIA_RESOLVER_TEMP_RETENTION_SECONDS` (temp files retention window)
- `DOWNLOADS_MAX_BYTES` + `DOWNLOADS_DIRECT_TIMEOUT_MS` (resolver/runtime limits)
- `DOWNLOADS_PROVIDER_YT_ENABLED` + `DOWNLOADS_PROVIDER_IG_ENABLED` + `DOWNLOADS_PROVIDER_FB_ENABLED` + `DOWNLOADS_PROVIDER_DIRECT_ENABLED` (provider toggles)
- `YT_RESOLVER_ENABLED` + `YT_RESOLVER_BASE_URL` + `YT_RESOLVER_TOKEN` + `YT_RESOLVER_TIMEOUT_MS` + `YT_RESOLVER_MAX_BYTES` (YouTube bridge to internal service)
- `FB_RESOLVER_ENABLED` + `FB_RESOLVER_BASE_URL` + `FB_RESOLVER_TOKEN` + `FB_RESOLVER_TIMEOUT_MS` + `FB_RESOLVER_MAX_BYTES` (Facebook bridge to internal service)
- `YOUTUBE_API_KEY` (optional official metadata enrichment for probe)
- `FACEBOOK_ACCESS_TOKEN` + `FACEBOOK_GRAPH_API_VERSION` (optional official metadata enrichment for probe)

Auxiliary internal bridge services (vendored)

- Location: `infra/external-services/youtube-resolver` and `infra/external-services/facebook-resolver`
- Local contract expected by bridge providers:
  - `GET /health`
  - `POST /resolve`
- Wrapper scripts:
  - `infra/external-services/youtube-resolver/scripts/bootstrap.sh`
  - `infra/external-services/youtube-resolver/scripts/run.sh`
  - `infra/external-services/facebook-resolver/scripts/bootstrap.sh`
  - `infra/external-services/facebook-resolver/scripts/run.sh`
