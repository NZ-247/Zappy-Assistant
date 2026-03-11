# Metrics & Observability (MVP)

This repository now exposes lightweight, Redis-backed counters to provide operational visibility without introducing a full metrics stack. The keys are namespaced as `metrics:<name>` in Redis and can be read via the Admin API.

## Counters available
- `messages_received_total` — inbound WhatsApp messages processed.
- `commands_executed_total` — commands parsed and handled (e.g., `/task`, `/reminder`).
- `trigger_matches_total` — trigger responses fired.
- `ai_requests_total` — outbound LLM/AI calls attempted.
- `ai_failures_total` — AI calls that failed.
- `reminders_created_total` — reminders scheduled/enqueued.
- `reminders_sent_total` — reminders delivered by the worker.
- `moderation_actions_total` — moderation/admin actions attempted (ban/kick/mute/delete).
- `onboarding_pending_total` — new consent requests opened.
- `onboarding_accepted_total` — consent acceptances recorded.

## How it works
- Counters are incremented in core/gateway/worker through a `MetricsPort` that writes to Redis.
- The Admin API exposes a summary at `GET /admin/metrics/summary`.
- Admin UI “Status” page has a “Metrics Summary” button to view the snapshot.

## Evolving this later
- Swap the `MetricsPort` implementation for Prometheus/OpenTelemetry exporters without changing domain code.
- Add per-tenant or per-group label support by extending the Redis schema (e.g., `metrics:<name>:<tenantId>`).
- Promote high-cardinality metrics to histograms once a metrics backend is introduced.
- Wrap Redis calls with batching if rate grows, or move to a dedicated monitoring pipeline.
