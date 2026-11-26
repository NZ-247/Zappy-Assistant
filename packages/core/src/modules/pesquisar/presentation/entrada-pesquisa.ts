import type { ResponseAction } from "../../../pipeline/actions.js";
import type { CooldownPort } from "../../../pipeline/ports.js";
import type { PipelineContext } from "../../../pipeline/context.js";
import type { SearchWithSources } from "../ports.js";

export async function runSearchSources(
  ctx: PipelineContext,
  search: SearchWithSources,
  query: string,
  origin: "command" | "conversation",
  isRoot: boolean,
  maxSources: number,
  cooldown: CooldownPort,
  scope: "operator" | "command" = "operator"
): Promise<ResponseAction[]> {
  const { event } = ctx;
  const isAdmin = ctx.requesterIsAdmin || (ctx.identity?.permissionRole ?? ctx.identity?.role)?.toUpperCase() === "ADMIN";
  if (scope === "operator" && (event.isGroup || event.waGroupId || ctx.consentRequired || ctx.policyMuted || (!isAdmin && !isRoot))) {
    return [{ kind: "reply_text", text: "A busca local com fontes está disponível no chat direto de operadores autorizados." }];
  }
  const conversationKey = JSON.stringify([event.tenantId, event.waGroupId ?? event.waUserId]);
  const replayKey = `search:sources:turn:${JSON.stringify([event.tenantId, event.waGroupId ?? event.waUserId, event.waMessageId])}`;
  try {
    if (!await cooldown.canFire(replayKey, 120)) return [{ kind: "noop", reason: "search_replay" }];
  } catch {
    return [{ kind: "reply_text", text: "A busca está indisponível no momento. Tente novamente em instantes." }];
  }
  return [{
    kind: "reply_text",
    text: await search({
      query, origin, maxSources,
      conversationKey,
      executionId: event.executionId ?? event.waMessageId
    })
  }];
}

export function explicitWebSearchQuery(text: string): string | undefined {
  return /^(?:por favor,?\s+)?(?:pesquise|busque|procure)\s+(?:na (?:web|internet)|online)(?:\s+sobre)?(?:\s*:\s*|\s+|$)(.*)$/iu.exec(text)?.[1];
}
