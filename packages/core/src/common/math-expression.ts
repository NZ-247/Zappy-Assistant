import { Parser } from "expr-eval";

export const evaluateExpression = (expression: string): number => {
  const parser = new Parser({
    operators: { logical: false, comparison: true },
    allowMemberAccess: false
  });
  const result = parser.evaluate(expression);
  if (typeof result !== "number" || Number.isNaN(result) || !Number.isFinite(result)) {
    throw new Error("Resultado inválido para a expressão.");
  }
  return result;
};
