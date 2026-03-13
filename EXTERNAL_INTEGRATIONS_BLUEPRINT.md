---

# 📄 `EXTERNAL_INTEGRATIONS_BLUEPRINT.md`

```markdown
# EXTERNAL_INTEGRATIONS_BLUEPRINT.md

# Zappy Assistant — External Integrations Blueprint

This document defines how **external services must be integrated into the Zappy Assistant architecture**.

External integrations include:

- APIs
- SaaS platforms
- file systems
- automation tools
- messaging platforms
- search engines
- cloud services

The purpose of this blueprint is to ensure integrations remain:

- modular
- replaceable
- testable
- platform-agnostic

---

# 1. Integration philosophy

Zappy Assistant follows **hexagonal architecture**.

This means:

Core logic **must never depend directly on external APIs**.

Instead:

```
Core
↓
Ports
↓
Adapters
↓
External systems
```

---

# 2. Integration layers

External integrations must follow this structure:


`modules/<module>/ports/outbound/`
`adapters/<integration>`


Example:

```
modules/reminders/ports/outbound/queue-port.ts
adapters/bullmq/reminder-queue.ts
```

---

# 3. Port definition

A port defines the contract used by core modules.

Example:

```ts
export interface LlmPort {
  generateReply(input: AiInput): Promise<AiOutput>
}
```

Ports must live inside module folders:

```modules/<module>/ports/```

# 4. Adapter implementation

Adapters implement ports using external APIs.

Example:

`adapters/openai/openai-llm.ts`

Adapter example:

```
export class OpenAiAdapter implements LlmPort {
  async generateReply(input) {
    return openai.chat.completions(...)
  }
}
```

Adapters must never leak SDK-specific types into core modules.

# 5. Supported integration categories

Common categories include:

 - Messaging Platforms
 - WhatsApp (Baileys)
 - Telegram
 - Discord
 - Slack

Gateway example:

 - apps/wa-gateway
 - LLM Providers
 - OpenAI
 - Anthropic
 - Local models
 - Azure OpenAI

Example port:

 - LlmPort
 - Search APIs
 - Google Custom Search
 - Bing
 - SerpAPI
 - DuckDuckGo

Example module:

 - modules/search
 - File processing
 - FFmpeg
 - ImageMagick
 - Sharp

Example module:

 - modules/media-fun
 - Automation platforms
 - n8n
 - Zapier
 - Make

Possible use:

 - workflow triggers
 - event automation
 - external webhooks
 - Storage systems
 - PostgreSQL
 - Redis
 - S3
 - Nextcloud

# 6. Adapter placement

Adapters must live in:

`packages/adapters/`

Example structure:
```
adapters/
  openai/
  redis/
  postgres/
  bullmq/
  whatsapp/
  google-search/
  ```

# 7. Dependency rule

Core modules must depend on ports, not adapters.

Forbidden:

```
import OpenAI from "openai"

Allowed:

import { LlmPort } from "../ports/llm-port"
```

Adapters provide the implementation.

# 8. Dependency injection

Adapters must be injected during application bootstrap.

Example:

`wa-gateway → constructs adapter → injects into core`

Example:
```
const ai = new OpenAiAdapter(...)
const orchestrator = new CoreOrchestrator({ llm: ai })
```

# 9. Error isolation

External integrations must isolate errors.

Adapters must convert external errors into safe responses.

Example:
```
OpenAI timeout
↓
Adapter catches error
↓
Returns safe fallback
↓
Core continues
```
The core must never crash due to integration failures.

# 10. Observability

All integrations must support:

 - metrics
 - audit logging
 - error logging
 - timeouts
 - retry policies

Prefer central metrics ports:

 - MetricsPort
 - AuditPort

# 11. Testing integrations

Adapters must support mocking.

Example:

`MockLlmAdapter`
`MockSearchAdapter`
`MockQueueAdapter`

Tests must run without external network calls.

# 12. Adding a new integration

When adding an integration:

Define port inside module

Implement adapter in `packages/adapters`

Inject adapter in `gateway/bootstrap`

Add configuration in .env

Document API usage

# 13. Configuration

External services must be configured through environment variables.

Example:
```
OPENAI_API_KEY=
SEARCH_API_KEY=
NEXTCLOUD_URL=
NEXTCLOUD_TOKEN=
```

No secrets must be hardcoded.

# 14. Future integrations

Possible future integrations include:

 - Google Drive
 - Nextcloud
 - Notion
 - Slack
 - Discord
 - Telegram
 - Calendar APIs
 - Email systems
 - CRM platforms
 - ERP systems

The architecture must remain flexible enough to support these without modifying core modules.

# 15. Integration lifecycle

Recommended integration lifecycle:
```
Idea
 ↓
Define Port
 ↓
Implement Adapter
 ↓
Inject Adapter
 ↓
Add Feature
 ↓
Add Metrics
 ↓
Add Tests
```
This ensures integrations remain safe and maintainable.

# 16. Long-term goal

The architecture should allow Zappy Assistant to become:

 - a multi-platform assistant

 - a modular automation hub

 - an integration orchestrator

 - a conversational interface for external systems


---
