import type { PipelineContext } from "../../../pipeline/context.js";
import type { ConversationState, ConversationStateRecord } from "../../../pipeline/types.js";
import type { ConversationStatePort } from "../../../pipeline/ports.js";
import type { PendingToolContext } from "../dto/pending-tool-context.js";

export const setPendingConversationState = async (
  ctx: PipelineContext,
  port: ConversationStatePort | undefined,
  state: ConversationState,
  pending: PendingToolContext,
  ttlMs: number
): Promise<void> => {
  if (!port) return;
  const expiresAt = new Date(ctx.now.getTime() + ttlMs);
  await port.setState({
    tenantId: ctx.event.tenantId,
    waGroupId: ctx.event.waGroupId,
    waUserId: ctx.event.waUserId,
    state,
    context: pending as unknown as Record<string, unknown>,
    expiresAt
  });
};

export const clearConversationState = async (
  ctx: PipelineContext,
  port: ConversationStatePort | undefined
): Promise<void> => {
  if (!port) return;
  await port.clearState({
    tenantId: ctx.event.tenantId,
    waGroupId: ctx.event.waGroupId,
    waUserId: ctx.event.waUserId
  });
};

export const getPendingContext = (state: ConversationStateRecord): PendingToolContext | null => {
  const ctx = state.context as PendingToolContext | undefined;
  if (!ctx || !ctx.pendingTool) return null;
  return {
    pendingTool: ctx.pendingTool,
    missing: ctx.missing ?? [],
    provided: ctx.provided ?? {},
    summary: ctx.summary
  };
};
