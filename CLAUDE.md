# Claude Operating Guide — Zappy Assistant

## 🎯 Project Overview

Zappy Assistant is a modular, scalable WhatsApp-based AI assistant platform designed to:

- Provide intelligent conversational experiences via WhatsApp
- Offer automation (reminders, commands, media processing)
- Support monetization via licensing tiers and governance
- Deliver pre-sales and customer onboarding for Services.NET
- Scale into a multi-tenant AI service platform

---

## 🧠 Core Principles

### 1. Stability First
Never break working flows:
- wa-gateway messaging
- worker queue processing
- governance enforcement
- admin-api control plane

### 2. Incremental Evolution
- Avoid large rewrites
- Prefer layered improvements
- Maintain backward compatibility

### 3. Clear Boundaries
- `core` = business logic
- `adapters` = infrastructure (DB, Redis, APIs)
- `apps/*` = runtime services
- `admin-api` = control plane
- `admin-ui` = presentation only

### 4. Runtime Philosophy
- PM2 is the process manager (single source of truth)
- No duplication between `start:dev` and PM2 runtime
- Avoid custom orchestration when PM2 already solves it

---

## ⚙️ Runtime Architecture

Services:

- admin-api → control plane (port 3333)
- wa-gateway → WhatsApp entrypoint (port 3334)
- media-resolver-api → media processing (port 3335)
- worker → background jobs (BullMQ)
- admin-ui → web interface (port 8080)

Infra:

- Redis → queue + caching
- PostgreSQL → persistence

---

## 📡 Observability

Every flow should be traceable using:

- executionId (transport layer)
- traceId (AI layer)

Logs must always show:
- input
- decision
- execution
- output

---

## 🧱 Governance Model

- Centralized in `core`
- Persisted via `admin-api`
- Enforced at runtime (wa-gateway + worker)

Hierarchy:

1. Access Status (APPROVED / BLOCKED / PENDING)
2. Tier (FREE / BASIC / PRO / ROOT)
3. Capabilities (bundles + overrides)
4. Runtime decision

---

## 💰 Monetization Strategy

- Free tier with limited usage
- Paid tiers unlock capabilities
- Future:
  - group-level billing
  - feature bundles
  - dynamic pricing

---

## 🤖 AI Behavior

Assistant must:

- Be helpful and structured
- Support pre-sales (Services.NET)
- Handle onboarding automatically
- Adapt tone based on user profile:
  - Creator (Pai)
  - Mother (Mãe)
  - Normal users

---

## 🧩 Development Guidelines

### DO:
- Keep modules isolated
- Write reusable helpers
- Use adapters for external dependencies
- Prefer composition over duplication

### DON'T:
- Hardcode business rules in UI
- Mix runtime orchestration with business logic
- Add unnecessary abstraction layers
- Introduce breaking changes

---

## 🧪 Testing Strategy

- Unit tests for core logic
- Integration tests for APIs
- Manual validation for WhatsApp flows

---

## 🚀 Future Direction

- AI decision routing layer
- RAG for pre-sales
- Performance optimization (Redis cache, PgBouncer)
- Full SaaS model
- Multi-tenant isolation

---

## ⚠️ Important Constraints

- Node.js 20 compatibility required
- BullMQ must be loaded via createRequire (CJS compatibility)
- PM2 is mandatory runtime manager
- Avoid ESM/CJS conflicts

---

## 🧭 Claude Role

Claude acts as:

- System architect
- Performance optimizer
- Refactoring assistant
- Stability guardian

Claude must always:
- analyze before changing
- explain tradeoffs
- preserve working behavior
- propose improvements with minimal risk