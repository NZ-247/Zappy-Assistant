# DEPLOYMENT_STRATEGY.md

# Zappy Assistant — Deployment Strategy

This document defines the official deployment strategy for the Zappy Assistant project.

It describes how the system should be deployed in:

- development environments
- staging environments
- production environments

It also defines:

- infrastructure requirements
- container strategy
- environment configuration
- secret management
- scaling approach
- monitoring and recovery practices

The deployment strategy is designed to support the modular architecture described in:

- ARCHITECTURE.md
- SYSTEM_PIPELINE_BLUEPRINT.md
- EXTERNAL_INTEGRATIONS_BLUEPRINT.md
- ROADMAP_ARCHITECTURE_EVOLUTION.md

---

# 1. System overview

Zappy Assistant is composed of multiple services:


apps/
wa-gateway
assistant-api
worker
admin-ui

packages/
core
adapters
shared
ai


Runtime services:

| Service | Role |
|------|------|
| wa-gateway | Messaging platform gateway |
| assistant-api | HTTP admin/API interface |
| worker | background jobs (reminders, queues) |
| admin-ui | operational dashboard |

Infrastructure dependencies:

| Dependency | Purpose |
|-----------|--------|
| PostgreSQL | persistent storage |
| Redis | queues, caching, state |
| OpenAI API | AI responses |

---

# 2. Deployment environments

The system should support three environments.

## Development

Purpose:

- local development
- feature testing
- debugging

Characteristics:

- single machine
- Docker containers for infra
- hot reload for services
- development logging

Typical run command:


npm run start:dev


Services started:

- wa-gateway
- assistant-api
- worker
- admin-ui
- postgres
- redis

---

## Staging

Purpose:

- integration testing
- pre-production validation

Characteristics:

- production-like infrastructure
- isolated database
- limited user access

Requirements:

- environment variables configured
- monitoring enabled
- logs centralized

Staging should simulate production as closely as possible.

---

## Production

Purpose:

- real user interactions
- stable operations

Characteristics:

- persistent infrastructure
- monitoring enabled
- backups configured
- secrets securely managed

Production must prioritize:

- reliability
- observability
- safe deployments
- quick rollback capability

---

# 3. Infrastructure requirements

Minimum infrastructure requirements:

| Component | Recommended |
|-----------|------------|
| CPU | 2+ cores |
| RAM | 4–8 GB |
| Storage | SSD recommended |
| Network | stable outbound internet |

External requirements:

- access to OpenAI API
- stable DNS/network connectivity

---

# 4. Container strategy

Deployment supports three runtime strategies:

- pure external dependencies (`--infra=external`)
- compose-managed dependencies (`--infra=managed`)
- hybrid autodiscovery (`--infra=auto`)

Docker is recommended for managed dependencies, but it is not mandatory for every production topology.

Recommended containers:


zappy-wa-gateway
zappy-assistant-api
zappy-worker
zappy-admin-ui
postgres
redis


Example docker services:


docker-compose.yml


Suggested structure:


services:
postgres
redis
wa-gateway
assistant-api
worker
admin-ui


Benefits (managed/hybrid modes):

- environment consistency
- easier scaling
- simpler upgrades

Operational requirements for infra containers:

- `postgres` and `redis` must have Docker `healthcheck`
- `postgres` and `redis` should use restart policy (`restart: unless-stopped`)
- app boot must be blocked until required dependencies are healthy

Runtime bootstrap policy:

- use `npm run start:dev|prod|debug` as the supervisor entrypoint
- startup performs deterministic dependency verification (`TCP port` + protocol check + ownership classification)
- Redis validation uses `PING`; PostgreSQL validation uses real connection check (`SELECT 1`)
- dependency source is classified as `external_host`, `external_container`, `compose_managed`, or `unavailable`
- in `--infra=auto`, startup skips compose-up when an external/native dependency is already usable
- in `--infra=external`, startup never compose-ups Redis/Postgres
- in `--infra=managed`, startup enforces compose-managed Redis/Postgres and may compose-up missing ones
- on failure, logs must include dependency name, attempted action, and final error reason

Auxiliary resolver runtime policy:

- Python resolvers are bootstrapped once (`npm run bootstrap:* -- --infra`)
- runtime start uses tmux-managed windows (`zappy:core`, `zappy:youtube`, `zappy:facebook`)
- stop with `--infra` closes only resolver windows owned by the current runtime

---

# 5. Environment configuration

All configuration must be provided through environment variables.

Primary configuration file example:


.env


Example variables:


NODE_ENV=production

BOT_PREFIX=/

OPENAI_API_KEY=

DATABASE_URL=

REDIS_URL=

ADMIN_API_TOKEN=

WA_SESSION_PATH=

LOG_LEVEL=info


Rules:

- `.env` must never be committed
- `.env.example` must be maintained
- secrets must be injected securely

---

# 6. Secret management

Secrets include:

- OpenAI API keys
- database credentials
- Redis credentials
- admin API tokens
- webhook tokens

Recommended secret storage methods:

- environment variables
- Docker secrets
- secret managers

Examples:


Vault
AWS Secrets Manager
1Password Secrets
Kubernetes secrets


Never store secrets in:

- source code
- git history
- logs

---

# 7. Database deployment

The system uses PostgreSQL via Prisma.

Deployment requirements:

- persistent volume
- scheduled backups
- migration management

Migration command example:


npx prisma migrate deploy


Backup strategy:

- daily database backup
- optional hourly snapshot
- secure offsite storage

---

# 8. Redis deployment

Redis supports:

- job queues
- metrics counters
- temporary state
- conversation state

Deployment requirements:

- persistent instance
- memory monitoring
- optional persistence enabled

Important:

Redis failure should not cause data corruption.

The system must tolerate temporary Redis outages when possible.

---

# 9. Service startup order

Recommended startup sequence:


PostgreSQL

Redis

worker

assistant-api

admin-ui

wa-gateway


Reason:

- queues depend on Redis
- APIs depend on database
- gateway depends on core services

---

# 10. Logging strategy

Logs must be structured and centralized.

Important logs:

| Type | Example |
|----|------|
| system logs | startup, shutdown |
| gateway logs | inbound/outbound messages |
| command logs | command execution |
| moderation logs | moderation actions |
| error logs | failures |

Logs should include:

- timestamp
- service name
- log level
- message
- metadata

Example format:


[service] [time] [level] message


---

# 11. Monitoring

Production deployments should monitor:

- service uptime
- Redis connectivity
- database connectivity
- worker queue health
- AI API failures
- gateway connection status

Recommended monitoring tools:


Prometheus
Grafana
Uptime Kuma
Sentry
Datadog


Metrics examples:

- messages processed
- commands executed
- AI requests
- reminder jobs processed
- queue backlog

---

# 12. Health checks

Each service should expose health indicators.

Examples:


/health
/admin/status
/admin/metrics


Health checks should validate:

- database connectivity
- Redis connectivity
- queue worker status
- gateway connection status

In addition to HTTP health endpoints, startup health must validate infrastructure dependencies before launching apps:

- preflight check for required containers (`postgres`, `redis`)
- automatic recovery attempt for missing/unhealthy dependencies
- post-recovery revalidation with bounded timeout (no blind retry loops)

---

# 13. Rolling updates

Recommended deployment pattern:


blue-green deployment
or
rolling restart


Safe update process:

1. deploy new container version
2. run database migrations
3. start services
4. verify health endpoints
5. route traffic

Rollback must always be possible.

---

# 14. Backup strategy

Critical data:

- PostgreSQL database
- configuration files
- WA session storage

Backup recommendations:

Database:

- daily backup
- secure storage
- restore tests periodically

Session storage:

- backup WA authentication directory

---

# 15. Scaling strategy

Early deployments run as a **single-node modular system**.

Future scaling options:

Horizontal scaling:


multiple gateways
multiple workers


Shared services:


shared Redis
shared PostgreSQL


Future message broker possibilities:


Kafka
NATS
RabbitMQ


Scaling should only occur when required.

---

# 16. Failure recovery

Common failures:

Gateway disconnect:

- reconnect automatically

Redis outage:

- temporary degraded functionality

Database outage:

- system must block critical operations safely

AI API outage:

- assistant fallback responses

The system should degrade gracefully rather than crash.

---

# 17. CI/CD deployment pipeline

Recommended pipeline:


lint
→ build
→ tests
→ docker build
→ deploy


Example CI tasks:

- TypeScript compilation
- unit tests
- module tests
- build artifacts

Deployment tools:


GitHub Actions
GitLab CI
Drone
Jenkins


---

# 18. Deployment safety checklist

Before production deploy:

Confirm:

- database migration completed
- Redis reachable
- environment variables loaded
- OpenAI API key valid
- admin token configured
- monitoring active

After deploy:

Test:

- `/status`
- `/help`
- AI response
- reminder scheduling
- admin UI access

---

# 19. Long-term infrastructure vision

The architecture allows gradual evolution to:

- multi-platform gateways
- distributed workers
- automation workflows
- external integration hub

Deployment must remain:

- reproducible
- observable
- scalable
- safe to upgrade

The deployment process should never compromise system stability.
