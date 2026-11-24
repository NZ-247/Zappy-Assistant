import type { ResponseAction } from "../../../pipeline/actions.js";
import type { PipelineContext } from "../../../pipeline/context.js";
import type { SearchWithSources } from "../ports.js";

export async function runSearchSources(
  ctx: PipelineContext,
  search: SearchWithSources,
  query: string,
  origin: "command" | "conversation",
  isRoot: boolean,
  maxSources: number
): Promise<ResponseAction[]> {
  const { event } = ctx;
  if (event.isGroup || event.waGroupId || ctx.consentRequired || ctx.policyMuted || (!ctx.requesterIsAdmin && !isRoot)) {
    return [{ kind: "reply_text", text: "A busca local com fontes está disponível no chat direto de operadores autorizados." }];
  }
  return [{
    kind: "reply_text",
    text: await search({
      query, origin, maxSources,
      conversationKey: JSON.stringify([event.tenantId, event.waUserId]),
      executionId: event.executionId ?? event.waMessageId
    })
  }];
}

export function explicitWebSearchQuery(text: string): string | undefined {
  return /^(?:por favor,?\s+)?(?:pesquise|busque|procure)\s+(?:na (?:web|internet)|online)(?:\s+sobre)?(?:\s*:\s*|\s+|$)(.*)$/iu.exec(text)?.[1];
}
