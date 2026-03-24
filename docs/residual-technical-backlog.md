# Residual Technical Backlog (Post Modular Migration)

Status em 2026-03-24:
- backlog residual **curto**
- sem bloqueio para evolução funcional
- foco em extrações incrementais sem mudança de comportamento

## Itens residuais priorizados

| Arquivo | Por que ainda merece extração | Direção sugerida |
|---|---|---|
| `packages/core/src/orchestrator/command-router.ts` | Arquivo ainda concentra muitas rotas/branches de comando e regras de fluxo, dificultando evolução isolada por módulo. | Quebrar por capacidades de comando e manter no router apenas dispatch/orquestração. |
| `apps/wa-gateway/src/infrastructure/outbound-actions.ts` | Mistura muitos tipos de ação de saída em um único fluxo (mensagens, admin de grupo, fila, auditoria/métrica), com alto acoplamento operacional. | Extrair executores por `action.kind` e manter um orquestrador mínimo de outbound no gateway. |
| `packages/shared/src/index.ts` | Ponto único muito carregado (env, logger, schemas e utilitários), elevando acoplamento transversal entre apps/pacotes. | Separar por domínio (`env`, `logging`, `contracts`, `utils`) e manter `index.ts` como barrel/composição leve. |
| `apps/assistant-api/src/index.ts` | Ainda combina bootstrap + wiring + definição de rotas + checks operacionais no mesmo arquivo. | Mover rotas e serviços operacionais para módulos próprios, deixando `index.ts` como composition root. |

## Regra de execução desse backlog

- realizar em passos pequenos (PR-style)
- preservar comportamento funcional
- manter build verde a cada extração
- evitar misturar novas features com refactor estrutural no mesmo change-set
