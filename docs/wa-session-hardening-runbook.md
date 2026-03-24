# WA Session Hardening Runbook

Status: 2026-03-24

Este runbook cobre resposta operacional para erros de sessão/decrypt do Baileys no `wa-gateway`.

## Sinais observáveis

Os logs do gateway agora classificam erros como `WA_DECRYPT_ISSUE` com:

- `issueCode`
- `severity` (`transient` ou `persistent_suspect`)
- `occurrences`
- `windowSeconds`
- `recommendation`

## Decisão operacional

1. `severity=transient` (ex.: `failed_to_decrypt_message`, `bad_mac`) e baixa recorrência
- ação: apenas monitorar e manter sessão
- não limpar auth state

2. `severity=persistent_suspect` recorrente (ex.: `no_matching_sessions`, `key_reuse_or_missing`)
- ação: preparar re-pair controlado
- validar antes:
  - se há reconnect em loop
  - se bot está recebendo/enviando normalmente
  - se o problema persiste após restart do `wa-gateway`

3. Persistência com impacto funcional (sem envio/recebimento estável)
- ação: re-pair obrigatório
- limpar sessão somente de forma manual e controlada (nunca automática)

## Procedimento seguro (manual)

1. Parar apenas o `wa-gateway`.
2. Fazer backup da pasta de sessão (`WA_SESSION_PATH`).
3. Reiniciar o `wa-gateway` e testar.
4. Se persistir, mover/remover sessão antiga e fazer novo pairing.
5. Confirmar em log:
- `WhatsApp CONNECTED`
- queda de `WA_DECRYPT_ISSUE` para nível residual.

## Nota

A aplicação não executa limpeza destrutiva automática de sessão.
