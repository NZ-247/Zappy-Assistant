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

### `apps/assistant-api`
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
- setup/runtime Python pertence ao módulo externo (`scripts/bootstrap.sh`, `scripts/run.sh`), não ao root

### `apps/admin-ui`
Consome apenas `assistant-api`, sem lógica de domínio embarcada.

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
