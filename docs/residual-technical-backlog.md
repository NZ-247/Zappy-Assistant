# Residual Technical Backlog (Post Modular Migration)

Status em 2026-03-24 (fechamento):
- backlog residual **encerrado**
- sem bloqueio para evolução funcional
- extrações realizadas sem mudança funcional intencional

## Itens residuais (resultado)

| Arquivo | Situação final | Resultado aplicado |
|---|---|---|
| `packages/core/src/orchestrator/command-router.ts` | Concluído | Extraído para `command-router-runtime.ts` e `command-router-stages.ts`; arquivo principal ficou como dispatcher do pipeline. |
| `apps/wa-gateway/src/infrastructure/outbound-actions.ts` | Concluído | Extraído para dispatcher + handlers por `action.kind` em `infrastructure/outbound/*`. |
| `packages/shared/src/index.ts` | Concluído | Separado em `env/`, `logging/`, `contracts/` e `index.ts` virou barrel leve. |
| `apps/assistant-api/src/index.ts` | Concluído | `index.ts` virou composition root; bootstrap/checks/rotas/admin auth movidos para módulos próprios. |

## Critérios aplicados no fechamento

- realizar em passos pequenos (PR-style)
- preservar comportamento funcional
- manter build verde a cada extração
- evitar misturar novas features com refactor estrutural no mesmo change-set
