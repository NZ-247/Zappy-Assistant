import type { PipelineContext } from "../../../pipeline/context.js";
import type { FlagsRepositoryPort } from "../../../pipeline/ports.js";
import type { ResponseAction } from "../../../pipeline/actions.js";

const chaves = {
  ia: { nome: "runtime.ia", valores: ["on", "off", "padrao"] },
  "search-ai": { nome: "runtime.search_ai", valores: ["on", "off", "padrao"] },
  pesquisar: { nome: "runtime.pesquisar", valores: ["on", "off", "padrao"] },
  "provedor-ia": { nome: "runtime.ia.provider", valores: ["ollama", "openai", "padrao"] },
  "provedor-busca": { nome: "runtime.search_ai.provider", valores: ["gemini", "openai", "padrao"] }
} as const;

export async function configurarRuntime(
  ctx: PipelineContext, texto: string, repo: FlagsRepositoryPort, raiz: boolean, uso: string, provedoresIa: string[], recursos: Record<string, boolean>
): Promise<ResponseAction[]> {
  const responder = (text: string): ResponseAction[] => [{ kind: "reply_text", text }];
  if (!raiz || ctx.event.isGroup || ctx.event.waGroupId) return responder("Configuração disponível para ROOT no chat direto.");
  const [, nome, valor, extra] = texto.toLowerCase().trim().split(/\s+/);
  if (!nome || !Object.hasOwn(chaves, nome) || extra) return responder(uso);
  const opcao = chaves[nome as keyof typeof chaves];
  if (!(opcao.valores as readonly string[]).includes(valor)) return responder(uso);
  if (valor === "on" && recursos[nome] === false) return responder("Este recurso está desligado na configuração de inicialização.");
  if (nome === "provedor-ia" && valor !== "padrao" && !provedoresIa.includes(valor)) {
    return responder("O provedor conversacional não está disponível para troca em execução.");
  }
  if (!repo.setTenantRuntimeFlag) return responder("Configuração em execução indisponível.");
  await repo.setTenantRuntimeFlag({ tenantId: ctx.event.tenantId, actor: ctx.event.waUserId, key: opcao.nome, value: valor });
  return responder(`Configuração salva: ${nome} = ${valor}.`);
}
