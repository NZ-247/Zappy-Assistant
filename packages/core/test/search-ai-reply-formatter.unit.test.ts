import { strict as assert } from "node:assert";
import test from "node:test";
import { formatSearchAiReply } from "../src/modules/search-ai/infrastructure/search-ai-reply-formatter.js";

test("search-ai formatter sanitizes markdown artifacts and noisy preambles", () => {
  const output = formatSearchAiReply({
    query: "ultimas noticias de ia no brasil",
    summary: `
Provider: openai_web_search
Model: gpt-4.1-mini
## Panorama
O setor de IA acelerou no Brasil em 2026 com novos investimentos.

- Mercado corporativo segue em alta.
* Reguladores discutem diretrizes adicionais.
1. Startups cresceram acima da média regional.

**Importante:** há debate sobre governança de dados.
`,
    sources: [
      { title: "Relatório setorial", url: "https://example.com/relatorio" },
      { title: "Matéria de contexto", url: "https://example.com/materia" }
    ],
    maxSources: 4
  });

  assert.doesNotMatch(output, /##/);
  assert.doesNotMatch(output, /^Provider:/im);
  assert.doesNotMatch(output, /^Model:/im);
  assert.match(output, /^Busca assistida:/m);
  assert.match(output, /^Resumo:/m);
  assert.match(output, /^Pontos-chave:/m);
  assert.match(output, /^Importante:/m);
  assert.match(output, /^Fontes:/m);
});

test("search-ai formatter trims verbosity for simple weather query and remains deterministic", () => {
  const input = {
    query: "clima hoje em alta floresta mt",
    summary:
      "## Clima agora\nHoje faz calor com máxima perto de 33°C e chance baixa de chuva no começo da tarde. " +
      "No fim do dia pode ocorrer pancada isolada. Vento fraco de norte. Umidade moderada. " +
      "Se sair no período da tarde, leve água e proteção solar.",
    sources: [{ title: "Boletim meteorológico", url: "https://example.com/clima" }],
    maxSources: 4
  };

  const outputA = formatSearchAiReply(input);
  const outputB = formatSearchAiReply(input);

  assert.equal(outputA, outputB);
  const bulletCount = outputA
    .split("\n")
    .filter((line) => line.trim().startsWith("- "))
    .length;
  assert.ok(bulletCount <= 2);
});

