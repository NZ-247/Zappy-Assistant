# Zappy Assistant (Bootstrap)

Monorepo foundation for Zappy Assistant using Node.js 20, TypeScript, Fastify, Prisma/PostgreSQL, Redis/BullMQ, and Docker Compose.

## Prerequisites

- Node.js 20+
- npm 10+
- Docker + Docker Compose

## Setup

1. Copy environment file:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

## Run with Docker Compose

```bash
npm run docker:up
```

Services:
- Assistant API: http://localhost:3333
- Admin UI: http://localhost:8080
- PostgreSQL: localhost:5432
- Redis: localhost:6379

Stop:
```bash
npm run docker:down
```

## Run locally

```bash
npm run dev
```

## Prisma

Generate client:
```bash
npm run prisma:generate
```

Run dev migrations:
```bash
npm run prisma:migrate
```

## Admin UI + API

- Open `http://localhost:8080`
- Enter API base URL (default `http://localhost:3333`) and `ADMIN_API_TOKEN` from `.env`
- Manage:
  - `/` feature flags
  - `/triggers` triggers
  - `/logs` audit logs

## Workspace layout

- `apps/assistant-api` Fastify admin/public API
- `apps/wa-gateway` WhatsApp gateway process stub
- `apps/worker` BullMQ worker skeleton
- `apps/admin-ui` static admin frontend served by Fastify
- `packages/shared` env/types/schemas/logger utilities
- `packages/core` interfaces/ports
- `packages/adapters` Prisma/Redis/BullMQ adapters + repositories
- `prisma/schema.prisma` data model
- `infra/docker-compose.yml` local infrastructure
