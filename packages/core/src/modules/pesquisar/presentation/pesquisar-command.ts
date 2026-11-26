import type { PipelineContext } from "../../../pipeline/context.js";
import type { CorePorts } from "../../../pipeline/ports.js";
import type { ResponseAction } from "../../../pipeline/actions.js";
import { runSearchSources } from "./entrada-pesquisa.js";

export async function executarPesquisar(
  ctx: PipelineContext, comando: string, ports: CorePorts, raiz: boolean, uso: string
): Promise<ResponseAction[]> {
  if (!ports.searchWithSources || ctx.flags["runtime.pesquisar"] === "off") {
    return [{ kind: "reply_text", text: "A pesquisa local está desligada." }];
  }
  const consulta = comando.replace(/^pesquisar\b/i, "").trim();
  if (!consulta) return [{ kind: "reply_text", text: uso }];
  return runSearchSources(ctx, ports.searchWithSources, consulta, "command", raiz, ports.searchAiMaxSources ?? 4, ports.cooldown);
}
