# ROADMAP_ARCHITECTURE_EVOLUTION.md

# Zappy Assistant — Architecture Evolution Roadmap

This document defines the **long-term architecture evolution plan** for the Zappy Assistant project.

The goal is to guide:

- future development
- refactoring decisions
- module expansion
- integration strategies
- system scalability

This roadmap reflects best practices used in production-grade conversational systems.

It assumes the architectural foundation described in:

- ARCHITECTURE.md
- MODULE_BLUEPRINT.md
- COMMAND_REGISTRY_BLUEPRINT.md
- SYSTEM_PIPELINE_BLUEPRINT.md
- EXTERNAL_INTEGRATIONS_BLUEPRINT.md

---

## Sequência operacional para o assistente de infraestrutura

O objetivo é usar o Zappy para pesquisar informações, consultar serviços e inventário, registrar conhecimento e supervisionar rotinas. A operação atual já inclui comandos de busca e mídia, tarefas, notas, lembretes e timers, fila e governança com auditoria. A conversa preserva contexto e pode sugerir ações, enquanto o piloto semântico registra propostas Zabbix. Consulta de inventário, relatórios Zabbix reais, documentação versionada e supervisão de infraestrutura ainda precisam de integração.

| Ordem | Entrega | Critérios de aceite |
| --- | --- | --- |
| 1 | Recuperação confiável no CT 110 | Boot real em janela de manutenção. Banco e Redis autenticados antes do PM2. Restaurar API, UI, media-resolver, worker e sessão WhatsApp sem intervenção. Conferir heartbeat, fila e ida e volta de uma mensagem. Validar também a recuperação independente do banco e usar o perfil PM2 compilado no deploy para que builds no checkout de trabalho não reiniciem a aplicação ativa. |
| 2 | Conversa local controlada | Começar com `qwen3:1.7b` no CT 120. Rodar uma amostra versionada de conversas PT-BR, memória de vários turnos e casos frios e aquecidos, com avaliação separada de qualidade e latência. Medir p50/p95 com e sem concorrência do modo sombra e registrar rate de timeout, truncamento e erros. Conferir degradação com os dois provedores indisponíveis, sem encaminhamento automático entre eles. Trocar o provedor de produção por configuração só após o aceite. |
| 3 | Ferramentas de leitura | Criar registro de capacidades com schemas, escopo por tenant, controle de acesso, deadline e auditoria correlacionada. Reusar busca web e portas dos módulos existentes. Integrar um relatório histórico do Zabbix por uma conta somente leitura com faixa de 1–168 h. Validar proposta, autorização, período, resposta com fonte e negativa para operador sem acesso. Em seguida, incluir inventário e consultas de serviços. |
| 4 | Supervisão e documentação | Usar o worker para rotinas idempotentes com tentativas limitadas e métricas. Iniciar com resumo de eventos do Zabbix e inventário reconciliado. Validar deduplicação, atraso, falhas, retomada e registro versionado das fontes. Enviar relatórios a destinos aprovados e registrar o resultado das entregas. |
| 5 | Ações sobre infraestrutura e publicação externa | Definir permissões específicas, catálogo de destinos e minimização de dados. Exigir aprovação do operador com prévia do alvo, efeito e dados de saída, vinculada à solicitação, expiração e ID de execução. Revalidar permissões no envio ou mudança, auditar a execução e testar rejeição, repetição e recuperação. |

O modelo propõe parâmetros ou redige a resposta. As portas de domínio executam operações após autorização. O piloto Zabbix avança de observação para leitura controlada antes de ganhar rotinas recorrentes ou qualquer capacidade de mutação.

# Phase 1 — Modular Core Foundation (Completed / In Progress)

Objective:

Stabilize the modular monolith architecture and remove monolithic logic from the core orchestrator.

Key accomplishments:

- command registry system
- configurable command prefix
- dynamic help generation
- identity module
- consent module
- groups module
- moderation module
- reminders module
- tasks module
- notes module
- assistant-ai module
- pipeline contracts extracted

Expected system characteristics:

- deterministic pipeline
- command-driven architecture
- module-based business logic
- minimal logic inside core orchestrator

Target outcome:

A **stable modular monolith** where new capabilities can be added without expanding the core.

---

# Phase 2 — Observability & Reliability

Objective:

Introduce strong observability and operational visibility.

New modules:

`modules/observability`

Capabilities:

- message metrics
- command metrics
- AI request metrics
- moderation metrics
- queue metrics
- heartbeat monitoring

Key improvements:

- centralized metrics pipeline
- structured audit logs
- admin operational dashboard
- error classification

Recommended technologies:

 - Redis counters
 - structured logs
 - Prometheus-compatible metrics

Outcome:

Operational visibility and debugging capability for production deployments.

---

# Phase 3 — Integration Layer Expansion

Objective:

Enable integrations with external services.

New modules:

`modules/search`
`modules/media-fun`
`modules/integrations`
`modules/automation`

Examples:

Search module:

`/search web`
`search image`
`/search news`

Media module:

`/sticker`
`/tts`
`/media download`

Automation module:

 - workflow triggers
 - scheduled automations
 - external event hooks

External systems:

`Google APIs`
`Nextcloud`
`n8n`
`Zapier`
`Make`
`ERP systems`
`CRM systems`

Outcome:

Zappy becomes a **conversational integration hub**.

---

# Phase 4 — Advanced AI Capabilities

Objective:

Improve assistant intelligence and conversational workflows.

Enhancements to:

`modules/assistant-ai`

New features:

Natural language command inference:

Example:
```
"remind me tomorrow at 9"
→ reminder module
```


Slot filling:
```
User: create a reminder
Assistant: when?
User: tomorrow
Assistant: what message?
```

Tool reasoning:

AI selects tools automatically.

Example:
```
"search images of cats"
→ search module
```

Persona management:

Assistant personas:

`professional`
`friendly`
`technical`


Context awareness:

Conversation state improvements.

Outcome:

AI becomes a **smart orchestration layer** rather than a simple chatbot.

---

# Phase 5 — Multi-Platform Support

Objective:

Run the assistant across multiple messaging platforms.

New gateways:


`apps/telegram-gateway`
`apps/discord-gateway`
`apps/slack-gateway`
`apps/web-chat-gateway`


Requirement:

All gateways must normalize events into:


InboundMessage


The pipeline remains unchanged.

Benefits:

- platform independence
- consistent behavior across platforms
- centralized logic

Outcome:

Zappy becomes a **multi-platform assistant**.

---

# Phase 6 — Automation Engine

Objective:

Enable advanced workflow automation.

New module:

`modules/automation`


Capabilities:

- workflow definitions
- event triggers
- scheduled jobs
- integration orchestration

Example workflows:

`When task completed → notify group`
`When server alert → create reminder`
`Daily summary → send report`


Integration with:

`n8n`
`Zapier`
`Make`
`custom webhooks`


Outcome:

Zappy evolves into an **automation orchestrator**.

---

# Phase 7 — Knowledge & Memory Systems

Objective:

Introduce persistent knowledge and memory.

New modules:


`modules/knowledge`
`modules/memory`


Capabilities:

Knowledge base queries:


`/kb search`
`/kb add`


Assistant memory:


preferences
conversation summaries
long-term context


Possible technologies:


vector databases
embeddings
document indexing


Outcome:

Assistant gains **contextual intelligence**.

---

# Phase 8 — Distributed Architecture (Optional)

Objective:

Support large-scale deployments.

Possible future changes:

- split worker services
- distributed message queues
- horizontal gateway scaling

Components:


message broker
stateless gateways
distributed workers


Technologies:


Kafka
NATS
RabbitMQ


This phase is optional and only required if the system scales significantly.

---

# Development guidelines

Every new feature must follow:


module → port → adapter


Never:

- bypass the pipeline
- add business logic to the core orchestrator
- directly integrate external SDKs into modules

Always:

- define ports
- implement adapters
- add registry metadata
- add documentation

---

# Architectural priorities

When evolving the system prioritize:

1. clarity of module boundaries
2. pipeline determinism
3. performance and latency
4. observability
5. testability

Feature speed must never compromise architecture.

---

# Long-term vision

Zappy Assistant aims to become:

- a modular conversational assistant
- a multi-platform automation hub
- an AI-driven integration interface
- a command-based productivity system

The architecture must remain:


predictable
modular
extensible
observable


All future changes should move the system **closer to this vision**.
