# Zappy Assistant — Architecture

## 1. Status da migração modular (2026-03-25)

As etapas 2A.1, 2A.2 e 2A.3 foram concluídas com sucesso.

Status oficial desta data:
- migração modular **praticamente concluída**
- sem bloqueio para evolução funcional
- pendências residuais pequenas, localizadas e já mapeadas
- capabilities novas entregues em módulos dedicados: `tts`, `web-search`, `search-ai`, `image-search`, `downloads`
- bootstrap de runtime endurecido com validação determinística de dependências Docker (estado + health + conectividade)

Encerramento prático da fase de migração:
- concluído para fins de evolução do produto
- novas capacidades devem iniciar no padrão modular oficial

### Consolidação já aplicada

Evidências de consolidação estrutural já presentes no código:
- `packages/core/src/index.ts` delegando classificação/policies para `packages/core/src/orchestrator/*`
- `packages/adapters/src/index.ts` compondo adapters especializados (`identity`, `tenant-context`, `status`)
- `apps/wa-gateway/src/index.ts` reduzido para composição, com handlers inbound e bootstrap extraídos

## 2. Direção arquitetural oficial

Zappy Assistant segue arquitetura de:
- **Modular Monolith**
- **Hexagonal Architecture (Ports and Adapters)**
- **Use cases por módulo**
- **Core transport-agnostic**
- **Codebase única com múltiplos runtimes**

Objetivo permanente:
- manter alta coesão por domínio
- evitar crescimento de arquivos centrais como god-file
- preservar extensibilidade para novos módulos e novos transports

## 3. Topologia de runtime

### `apps/wa-gateway`
Responsável por ingress/egress WhatsApp (Baileys), normalização de eventos e execução de ações de plataforma.

### `apps/admin-api`
Responsável por endpoints administrativos, status, métricas, filas e auditoria.

### `apps/worker`
Responsável por jobs assíncronos, lembretes, timers e processamento em background.

### `apps/media-resolver-api`
Serviço interno dedicado para `/dl` com pipeline staged por provider (`detect -> probe -> resolveAsset -> download -> normalizeForWhatsApp`), TTL de jobs e cleanup de arquivos temporários em Redis.

### `infra/external-services/*`
Serviços auxiliares internos (não-Node, fora de workspaces npm) usados pelos bridges `yt`/`fb` do `media-resolver-api`.

- `infra/external-services/youtube-resolver`
- `infra/external-services/facebook-resolver`

Regras:
- wrappers finos expõem contrato mínimo (`GET /health`, `POST /resolve`)
- payload cru de serviço externo não sobe para `wa-gateway`
- falhas desses auxiliares não devem derrubar runtimes não relacionados
- orquestração raiz (`scripts/bootstrap.mjs`, `scripts/start.mjs`, `scripts/stop.mjs`) apenas delega entrypoints de módulo com `cwd` do resolver
- `start` adota fluxo health-first (`already_running` quando `/health` está OK; delegação para `scripts/run.sh` apenas quando necessário)
- `start` dos apps root aplica precheck por porta (`ready_to_start`, `already_running_same_service`, `port_conflict_unknown_process`) antes de spawn; evita duplicar processos quando a mesma service já está ativa
- `stop` delega para `scripts/stop.sh` somente quando o módulo disponibiliza esse entrypoint; caso contrário, a ação é manual e explicitamente logada
- `stop` faz reconciliação final das portas root (`8080`, `3333`, `3334`, `3335`) com status explícito (`stopped_by_pid`, `already_stopped`, `port_still_busy_unknown_process`) sem matar processos desconhecidos
- estratégia Redis em runtime permanece `external|managed|auto`, com logging explícito de source/version (`external_host`, `compose_managed`, etc.) para decisão operacional auditável
- setup/runtime Python pertence ao módulo externo (`scripts/bootstrap.sh`, `scripts/run.sh`), não ao root

### `apps/admin-ui`
Consome apenas `admin-api`, sem lógica de domínio embarcada.

### Pacotes compartilhados
- `packages/core`: pipeline de aplicação, orquestração e dispatch
- `packages/adapters`: implementações concretas de portas (Prisma, Redis, BullMQ, OpenAI, etc.)
- `packages/shared`: env, logger, contratos e utilitários compartilhados
- `packages/ai`: persona, prompt building e orquestração de memória/intents

## 4. Fluxo lógico de aplicação (alto nível)

1. Normalização de entrada + replay/backlog guard (startup watermark da instância + dedupe claim por `remoteJid/waMessageId` + stale age guard `INBOUND_MAX_MESSAGE_AGE_SECONDS`)
2. Resolução de identidade e contexto
3. Verificações de consentimento/acesso
4. Classificação de intenção
5. Dispatch para módulo/use-case
6. Execução da regra de negócio
7. Normalização de ações de saída
8. Renderização por plataforma
9. Auditoria e métricas

## 5. Padrão oficial de módulo (V1+)

Toda feature nova deve nascer sob `packages/core/src/modules/<module-name>/`:

```text
<module-name>/
  domain/
  application/
    use-cases/
  presentation/
    commands/
  infrastructure/
  ports/
  ports.ts
  index.ts
```

Regras do padrão:
- `presentation/commands`: parsing e validação leve; delega para use-cases
- `application/use-cases`: regra de negócio e orquestração de domínio
- `domain`: entidades, regras e invariantes
- `ports`/`ports.ts`: contratos de dependência do módulo
- `infrastructure` (dentro do módulo): helpers/parsers internos sem SDK externo
- `index.ts` do módulo: composição/export do módulo, sem regra de negócio inline

## 6. Regras de fronteira e responsabilidade

### 6.1 `index.ts` como composition root

Arquivos `index.ts` (especialmente em apps e no core) devem ser usados para:
- composição de dependências
- orquestração de alto nível
- inicialização/bootstrapping

Não devem concentrar regra de negócio.

### 6.2 Handlers e comandos devem ser finos

Handlers/comandos devem:
- interpretar entrada
- validar pré-condições simples
- delegar rapidamente para use-cases

Devem evitar decisões de negócio complexas no próprio handler.

### 6.3 Regra de negócio em use-cases/domínio

Toda decisão de negócio deve viver em:
- `application/use-cases`
- `domain`

Isso garante testabilidade isolada e evolução segura por módulo.

### 6.4 Separação entre adapters e infrastructure

Separação oficial:
- `packages/adapters` e infraestrutura de apps: integração com SDK/framework/IO externo
- `infrastructure` interna do módulo no core: utilitários internos sem acoplamento de plataforma

Regra central:
- use-cases do core dependem de **ports**, nunca de SDK concreto.

## 7. Sistema de comandos e prefixo

- comando deve ser registrado no Command Registry com metadados (`name`, `aliases`, `scope`, `requiredRole`, `botAdminRequired`, `progressAck`, `description`, `usage`, `examples`)
- prefixo global via `BOT_PREFIX` (default `/`)
- parsing e help devem respeitar o prefixo ativo
- `/help` deve permanecer orientado por metadata do registry
- comandos desconhecidos não devem cair em AI por acidente; somente por política explícita

## 8. Backlog técnico residual (encerrado em 24/03/2026)

As pendências residuais não bloqueiam evolução funcional e estão formalizadas em:
- `docs/residual-technical-backlog.md`

Itens encerrados com extração incremental e sem mudança funcional intencional:
- `packages/core/src/orchestrator/command-router.ts` -> extraído para runtime + stages
- `apps/wa-gateway/src/infrastructure/outbound-actions.ts` -> extraído para dispatcher + handlers por `action.kind`
- `packages/shared/src/index.ts` -> transformado em barrel com separação `env`/`logging`/`contracts`
- `apps/assistant-api/src/index.ts` -> reduzido a composition root com bootstrap/rotas em módulos
- `apps/admin-api/src/index.ts` -> novo control plane dedicado com rotas administrativas versionadas

Referência detalhada:
- `docs/residual-technical-backlog.md`

## 9. Padrão oficial para capabilities (tools)

Diretriz oficial para próxima fase (multimídia/utilitários):
- módulo-first também para ferramentas do assistente
- capabilities separadas em `modules/tools/<capability>`
- dependências pesadas isoladas em adapters e carregadas sob demanda
- ativação gradual por feature flag/política

Capabilities entregues neste padrão:
- `packages/core/src/modules/tools/stickers` com comandos `/sticker` (`/s`, `/stk`, `/fig`), `/toimg` e `/rnfig`
- execução concreta de conversão isolada no `apps/wa-gateway` (fora do core)
- versão atual da capability: sticker por imagem/vídeo curto com limite configurável (`STICKER_MAX_VIDEO_SECONDS`), `contain + transparent padding`, conversão sticker->imagem e rename de metadados EXIF
- `packages/core/src/modules/tools/audio` com foco STT-first (`/transcribe` + áudio inbound auto)
- STT isolado por porta (`SpeechToTextPort`) e adapter concreto no pacote `adapters`
- roteamento dinâmico de comando por transcrição com heurística controlada (prefixo explícito, `slash|barra`, allowlist + confiança mínima)
- reações de progresso reutilizáveis em operações pesadas (stickers/áudio), best-effort e sem quebrar fluxo funcional
- `packages/core/src/modules/tts` com parser compatível (`texto|destino|voz`) + opção explícita (`texto|origem|destino|voz`), tradução pré-síntese e saída em `reply_audio` com suporte a PTT
- normalização de áudio outbound para WhatsApp centralizada em pipeline canônico de voice note (`apps/wa-gateway/src/infrastructure/outbound/handlers/wa-audio-send-pipeline.ts`), sem fallback silencioso para áudio genérico
- `packages/core/src/modules/translation` dedicado ao comando `/trl`, com auto-detecção de idioma, alvo padrão pt<->en, suporte a texto/áudio respondido e saída compacta para WhatsApp
- `packages/core/src/modules/web-search` com provider configurável, ranking/deduplicação e resposta textual legível (título/resumo/link)
- `packages/core/src/modules/search-ai` dedicado à busca assistida por IA com internet e resposta resumida com fontes
- `packages/core/src/modules/image-search` separado da busca textual, com estratégia native-first (Wikimedia/Openverse/Pixabay/Pexels/Unsplash), fallback Google CSE apenas para descoberta e suporte a `/imglink` para fallback estruturado em links
- `packages/core/src/modules/downloads` com camada comum de parsing/validação e delegação para resolver interno, mantendo `wa-gateway` leve
- `apps/media-resolver-api` centraliza resolução/download/normalização por provider e remove lógica pesada de `/dl` do gateway
- provider `ig` reaproveita o pipeline staged já estável (`/p/`, `/reel/`, `/tv/`) com fallback seguro para privado/login-required
- providers `yt` e `fb` podem operar por bridges internas (`yt-resolver-service` e `fb-resolver-service`) para wrappers externos (ex.: projetos Python), mantendo a normalização oficial no `media-resolver-api`
- wrappers auxiliares vivem em `infra/external-services/*` com bootstrap isolado por `venv` e sem entrar no grafo de dependências Node
- contratos públicos internos continuam estáveis (`detect -> probe -> resolveAsset -> download -> normalizeForWhatsApp`), sem expor payloads crus de serviços auxiliares
- chaves oficiais (`YOUTUBE_API_KEY`, `FACEBOOK_ACCESS_TOKEN`) permanecem opcionais para enriquecimento de metadata/probe, sem depender delas para asset direto
- evolução incremental do módulo de downloads documentada em `docs/downloads-module-evolution.md`

Referência detalhada:
- `docs/capability-modules-blueprint.md`

## 10. Diretriz para próxima fase funcional

A partir deste marco:
- novas features devem nascer já no padrão modular oficial
- evitar expansão de lógica em arquivos centrais
- preservar o core como orquestrador e composition root
- manter desenho resource-aware (baixo consumo, execução sob demanda, limites explícitos)

Guardrail de UX aplicado nesta fase:
- papéis internos (`ROOT`, `creator_root`, `bot_admin` e similares) permanecem no domínio de autorização/contexto
- camada de resposta visível ao usuário usa resolução segura de nome de tratamento com fallback neutro (`você`)

Este documento registra oficialmente a migração modular como encerrada na prática em **24/03/2026** e a base pronta para expansão de capabilities sem iniciar moderação nesta etapa.

## 11. Governance Foundation (v1.6.2)

Phase 1 do plano Admin adiciona a base oficial de governança em **shadow mode**:

- `packages/core/src/modules/governance/*`
  - contratos (`DecisionInput`, `DecisionResult`, `GovernancePort`)
  - reason codes e diagnósticos de política
  - use case `resolveGovernanceDecision`
- `packages/adapters/src/governance/*`
  - adapter transitório read-only
  - composição de fontes existentes: feature flags, group settings, bot admins, consent e sinais runtime
- `apps/assistant-api`
  - endpoint read-only `GET /admin/v1/governance/snapshot`
- `apps/wa-gateway`
  - avaliação de decisão em shadow mode antes do roteamento normal
  - logging estruturado de decisão/reasons/contexto seguro

Regras de fase:

- sem mudança de comportamento funcional ao usuário final
- sem enforcement em runtime nesta etapa
- sem acoplamento de regra de governança em transports/apps
- base pronta para enforcement progressivo nas próximas fases do control plane

## 12. Admin API Foundation (v1.6.3)

Phase 2 do plano Admin adiciona a primeira base persistida do control plane:

- novo app dedicado `apps/admin-api`
  - guard de autenticação para rotas `/admin*`
  - endpoint de saúde (`GET /health`)
  - estrutura versionada `/admin/v1/*`
- novas entidades persistidas de governança administrativa:
  - `UserAccess`
  - `GroupAccess`
  - `LicensePlan`
  - `UsageCounter`
  - `ApprovalAudit`
- adapter de governança refinado para ler estado persistido de aprovação/tier:
  - materialização segura no primeiro contato (`status=PENDING`, `tier=FREE`)
  - decisão continua em shadow mode, sem enforcement global forçado nesta fase
- endpoints v1 para aprovações/licenças/uso/auditoria, com payloads admin-friendly e versionados.

## 13. Admin UI MVP (v1.7.0)

Phase 3 do plano Admin entrega o primeiro painel operacional navegável no browser:

- `apps/admin-ui` consolidado como interface presentation-only do control plane
- consumo exclusivo de `admin-api` (sem lógica de domínio/política no frontend)
- páginas MVP:
  - Dashboard
  - Users
  - Groups
  - Licenses/Plans
  - Audit
  - Jobs/Reminders
- UX operacional com estados explícitos:
  - loading
  - empty
  - unauthorized/token inválido
  - network/upstream unavailable
  - backend parcial/degradado

Evoluções de backend para suportar o MVP sem quebrar fronteiras:

- `admin-api` status expandido para `admin.status.v2` com:
  - health por serviço (gateway/worker/admin-api/media-resolver/assistant-api opcional)
  - resumo de queue/reminders
  - resumo de falhas recentes e warnings
  - versão corrente do projeto
- novos endpoints de jobs/reminders administrativos:
  - `GET /admin/v1/reminders`
  - `POST /admin/v1/reminders/:reminderId/retry` (retry seguro para `FAILED`)
- `media-resolver-api` expõe `GET /health` para observabilidade do dashboard

Decisão arquitetural chave da fase:

- manter a inteligência administrativa no `admin-api` e adapters
- permitir ao `admin-ui` apenas orquestrar leitura/escrita via contratos HTTP estáveis

## 14. Runtime Enforcement Phase 1 (v1.7.1)

Phase 4 inicia enforcement real e incremental em runtime usando estado persistido do control plane, mantendo a decisão centralizada no core:

- `packages/core/src/modules/governance/*`
  - `resolveGovernanceDecision` passa a aplicar:
    - enforcement de acesso (`PENDING`, `APPROVED`, `BLOCKED`)
    - gating inicial por tier/capability (`FREE`, `BASIC`, `PRO`, `ROOT`)
    - hook inicial de quota (`FREE` direct-chat)
  - reason codes e diagnósticos agora representam bloqueios de acesso/licença/quota para consumo uniforme por runtimes
- `packages/adapters/src/governance/*` + `packages/adapters/src/index.ts`
  - `GovernancePort` ganha hook opcional `consumeQuota`
  - contador persistido em `UsageCounter` passa a ser usado no bucket inicial de conversa direta FREE
- `apps/wa-gateway`
  - deixa de ser apenas shadow-only e aplica short-circuit antes de command/AI para decisões negadas no escopo desta fase
  - mantém shadow telemetry opcional para observabilidade contínua (`GOVERNANCE_SHADOW_MODE`)
  - adiciona toggle explícito de enforcement (`GOVERNANCE_ENFORCEMENT_ENABLED`)
- `apps/worker`
  - reminders/timers revalidam política no momento da execução
  - execução negada por política atual falha de forma explícita e auditável

Guardrails de rollout da fase:

- enforcement limitado apenas às capabilities definidas nesta versão (sem “big bang”)
- features fora do escopo continuam com comportamento estável anterior
- apps de runtime consomem decisão de governança; não duplicam regra de política

## 15. Runtime Enforcement Phase 2 (v1.8.0)

Phase 5 evolui o modelo de governança para política de capabilities flexível, mantendo o core como fonte da decisão e adapters como fonte de persistência:

- `packages/core/src/modules/governance/domain/capability-policy.ts`
  - catálogo formal de capabilities (incluindo `command.hidetag`)
  - catálogo de bundles (`basic_chat`, `search_tools`, `audio_tools`, `image_tools`, `download_tools`, `moderation_tools`, `productivity_tools`)
  - mapeamento de bundles default por tier (`FREE|BASIC|PRO|ROOT`)
  - resolução efetiva de capability com precedência explícita (deny-wins)
- `packages/core/src/modules/governance/application/use-cases/resolve-governance-decision.ts`
  - ordem de enforcement:
    - status de acesso
    - defaults do tier
    - grants por bundle
    - overrides explícitos (user/group)
    - deny-all/flags e quota checks existentes
  - atribuição de fonte de negação (`tier_default`, `missing_bundle`, `explicit_override_deny`, `blocked_status`, `quota_denied`)
- `packages/core/src/commands/registry/*` + `apps/wa-gateway/src/inbound/governance-shadow.ts`
  - command registry passa a carregar `capability` explícita por comando
  - runtime usa mapeamento orientado por metadata do registry, evitando hardcode espalhado em transport
- `packages/adapters` + `prisma/schema.prisma`
  - persistência dedicada para política de capability:
    - `CapabilityDefinition`
    - `CapabilityBundle`
    - `CapabilityBundleCapability`
    - `TierBundleDefault`
    - `UserBundleAssignment`
    - `GroupBundleAssignment`
    - `UserCapabilityOverride`
    - `GroupCapabilityOverride`
  - adapter de governança passa a compor snapshot de policy para consumo do core
- `apps/admin-api` + `apps/admin-ui`
  - API/UX operacional para catálogo, bundles, overrides e visualização de capability efetiva por usuário/grupo
  - frontend permanece presentation-only: decisão final e persistência continuam no admin-api/adapters/core

Decisões arquiteturais da fase:

- tier deixa de ser fonte final de verdade e passa a ser baseline de entitlement
- grants por bundle e overrides explícitos viabilizam cenários comerciais/teste sem mudança de código no runtime
- precedência em escopo de grupo: deny-wins; sem deny, user allow tem prioridade sobre group allow
- observabilidade de governança passa a expor capability solicitada + fonte primária de deny para troubleshooting rápido
