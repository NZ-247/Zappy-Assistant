# Capability Modules Blueprint (Tools)

Status: oficial para próxima fase (pós-migração modular).

Objetivo:
- habilitar novas ferramentas (mídia, figurinhas, áudio, web, downloads) sem inflar `core/index.ts`
- manter baixo acoplamento entre core, gateway e SDKs externos
- suportar ativação gradual com consumo controlado de recursos

## 1. Domínio vs Capability

Módulos de domínio (ex.: `tasks`, `reminders`, `groups`):
- modelam regras de negócio centrais do assistente
- tendem a persistir estado próprio e invariantes de negócio
- são base do comportamento principal do produto

Módulos de capability/ferramenta (ex.: `tools/audio`, `tools/web`):
- encapsulam execução de ferramentas sob demanda
- podem depender de provedores externos e processamento pesado
- devem ser opcionais, isoláveis e desativáveis por política/flag

## 2. Estrutura oficial para tools

Estrutura recomendada em `packages/core/src/modules/tools/`:

```text
tools/
  stickers/
    application/
      use-cases/
    presentation/
      commands/
    infrastructure/
    ports/
    ports.ts
    index.ts
  media/
  audio/
  web/
  downloads/
```

Regra:
- cada capability é um módulo independente
- sem `commands.ts` gigante compartilhado para todas as tools
- sem lógica de provider/SDK dentro de use-cases do core

## 3. Blueprint de módulo de capability

`application/use-cases`:
- fluxo da capability (validação de input, quotas, orquestração)
- retorno em `ResponseAction` normalizado
- sem import de SDK externo

`presentation/commands`:
- parse/validação leve de comando
- delega para use-cases
- sem regra pesada de processamento multimídia

`ports.ts`:
- contratos necessários da capability (transcoder, downloader, web-reader, tts, stt, image-search etc.)
- sem tipos de framework externo

`infrastructure/` (no core):
- parsers/normalizadores internos da capability
- sem IO externo e sem SDK de plataforma

Implementações concretas:
- em `packages/adapters` (ou app runtime quando estritamente de plataforma)
- `wa-gateway` fica responsável por transporte e detalhes de envio/recebimento

## 4. Regras antiacoplamento

- `packages/core` não importa Baileys, Prisma, BullMQ, OpenAI SDK ou libs multimídia concretas
- `apps/wa-gateway` não recebe regra de negócio de tools; só ingress/egress/plataforma
- `packages/core/src/index.ts` apenas orquestra e faz dispatch
- command registry continua fonte única para metadata/help

## 5. Rollout gradual e resource-aware

Diretriz oficial:
- feature-flag por capability (ex.: `tools.audio.enabled`, `tools.web.enabled`)
- dependências pesadas inicializadas sob demanda
- operação da tool somente quando comando/intent exigir

Regras práticas:
- inicialização lazy de adapters de capability
- limite de tamanho de mídia, timeout e concorrência por tool
- short-circuit quando capability estiver off (resposta curta e auditável)
- preferir pipelines curtos e canceláveis no host atual

## 6. Ordem recomendada de implementação

1. `tools/media` + `tools/stickers` (baixo risco, alto valor)
2. `tools/audio` (TTS primeiro, STT/entendimento depois)
3. `tools/web` (leitura de links e busca de imagens com políticas)
4. `tools/downloads` (com validação de origem, tamanho e limites)

Moderação permanece fora desta fase.
