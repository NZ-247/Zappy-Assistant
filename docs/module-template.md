# Module Template (V1+)

Use este template ao criar novos módulos em `packages/core/src/modules/<module-name>/`.

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

## Regras rápidas

- `presentation/commands`:
  - parsing/validação leve
  - delega para use-cases
  - não contém regra de negócio
- `application/use-cases`:
  - regra de negócio do módulo
  - depende de contratos (`ports.ts`), nunca de SDK
- `infrastructure`:
  - parsers/helpers internos do módulo
  - sem dependência de runtime externo
- `ports/` e `ports.ts`:
  - contratos de entrada/saída do módulo
  - `ports.ts` é o ponto de export padrão
- `index.ts`:
  - exporta o que o orquestrador precisa
  - sem lógica de negócio inline

## Exemplo mínimo

```ts
// application/use-cases/do-something.ts
import type { SomethingPort } from "../../ports.js";

export const doSomething = async (port: SomethingPort, input: { tenantId: string }) => {
  return port.run(input);
};
```

```ts
// presentation/commands/something-command.ts
import { doSomething } from "../../application/use-cases/do-something.js";

export const handleSomethingCommand = async (deps: { port: any }, tenantId: string) => {
  return doSomething(deps.port, { tenantId });
};
```
