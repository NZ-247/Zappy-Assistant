import { zappyPersona } from "./persona.js";

export interface PromptOptions {
  tenantName?: string;
  mode?: "professional" | "fun" | "mixed";
  timezone?: string;
  extras?: string[];
}

export const buildSystemPrompt = (options: PromptOptions = {}): string => {
  const parts = [zappyPersona.trim()];
  const mode = options.mode ?? "professional";
  const timezone = options.timezone ? `Timezone preferencial: ${options.timezone}.` : undefined;
  const styleLines = [
    "Responda em 1-3 frases.",
    "Seja específica em datas/horários.",
    "Para comandos do usuário, confirme ações e resuma o resultado.",
    "Quando não souber, peça dados curtos em vez de inventar."
  ];

  if (mode === "fun" || mode === "mixed") styleLines.push("Pode usar leve descontração, mas mantendo objetividade.");
  if (timezone) styleLines.push(timezone);
  if (options.tenantName) styleLines.push(`Contexto do cliente: ${options.tenantName}.`);
  if (options.extras?.length) styleLines.push(...options.extras);

  parts.push(styleLines.join(" "));
  return parts.join("\n\n");
};
