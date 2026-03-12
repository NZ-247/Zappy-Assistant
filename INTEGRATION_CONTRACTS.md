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

4. UI page mapping
4.1 Status page

Uses:

/admin/status

/admin/metrics/summary

Widgets:

gateway status

worker status

bot status

DB/Redis status

LLM enabled/model

queue mini-summary

top-level counters

4.2 Queues page

Uses:

/admin/queues

Widgets:

queues table

badges for waiting/active/failed

optional alert if failed > 0

4.3 Commands page

Uses:

/admin/commands

Widgets:

command audit table

columns:

timestamp

user

command

summary

status

4.4 Messages page

Uses:

/admin/messages

Widgets:

message activity feed/table

columns:

timestamp

direction

user

group/private

preview

type

5. UI state requirements

Every UI implementation should support:

Loading state

skeleton or spinner

Empty state

Examples:

no commands yet

no messages yet

no queues configured

Error state

Examples:

unauthorized

failed to fetch

backend unavailable

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

LLM_ENABLED

OPENAI_MODEL

Not all need dedicated endpoints immediately, but these are relevant system settings.

7. Future contract areas

Potential future endpoints/pages:

group settings

reminders list

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
