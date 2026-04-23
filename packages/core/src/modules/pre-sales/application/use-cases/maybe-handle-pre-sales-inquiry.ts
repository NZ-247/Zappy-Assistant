import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { PipelineContext } from "../../../../pipeline/context.js";
import { SERVICES_NET_PRESALES_KNOWLEDGE_BASE } from "../../domain/services-net-knowledge-base.js";
import { generatePreSalesResponse } from "./generate-pre-sales-response.js";
import { triageServiceInquiry } from "./triage-service-inquiry.js";

export interface MaybeHandlePreSalesInquiryDeps {
  stylizeReply?: (text: string) => string;
}

export const maybeHandlePreSalesInquiry = async (
  ctx: PipelineContext,
  deps: MaybeHandlePreSalesInquiryDeps = {}
): Promise<ResponseAction[]> => {
  if (ctx.groupPolicy?.commandsOnly) return [];
  if (ctx.policyMuted) return [];
  if (!ctx.event.normalizedText) return [];
  if (!["ai_candidate", "trigger_candidate"].includes(ctx.classification.kind)) return [];

  // In groups, keep pre-sales replies explicit to addressed interactions.
  if (ctx.event.isGroup && !(ctx.isBotMentioned || ctx.isReplyToBot)) return [];

  const triage = triageServiceInquiry(ctx.event.normalizedText, SERVICES_NET_PRESALES_KNOWLEDGE_BASE);
  const resolution = generatePreSalesResponse(triage, SERVICES_NET_PRESALES_KNOWLEDGE_BASE);

  if (!resolution.handled || !resolution.text) return [];

  return [{ kind: "reply_text", text: deps.stylizeReply ? deps.stylizeReply(resolution.text) : resolution.text }];
};
