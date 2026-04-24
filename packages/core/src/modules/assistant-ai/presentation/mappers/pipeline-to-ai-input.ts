import type { PipelineContext } from "../../../../pipeline/context.js";
import type { AiAssistantInput, ToolAction } from "../../../../pipeline/types.js";

export const normalizeUserRole = (role?: string): AiAssistantInput["userRole"] => {
  const upper = role?.toUpperCase?.();
  if (upper === "ROOT") return "ROOT";
  if (upper === "DONO") return "DONO";
  if (upper === "GROUP_ADMIN" || upper === "ADMIN") return upper === "ADMIN" ? "ADMIN" : "GROUP_ADMIN";
  return "MEMBER";
};

export const mapPipelineToAiInput = (
  ctx: PipelineContext,
  availableTools: ToolAction[] = []
): AiAssistantInput => ({
  tenantId: ctx.event.tenantId,
  conversationId: ctx.event.conversationId,
  waUserId: ctx.event.waUserId,
  waGroupId: ctx.event.waGroupId,
  userText: ctx.event.text,
  userDisplayName: ctx.addressingName,
  chatScope: ctx.event.isGroup ? "group" : "direct",
  userRole: normalizeUserRole(ctx.identity?.permissionRole ?? ctx.identity?.role),
  relationshipProfile: ctx.relationshipProfile,
  modulesEnabled: [],
  availableTools,
  conversationState: ctx.conversationState.state,
  handoffActive: ctx.conversationState.state === "HANDOFF_ACTIVE",
  settings: { timezone: ctx.timezone },
  now: ctx.now,
  llmEnabled: ctx.assistantMode !== "off",
  personaId: ctx.flags.assistant_persona ?? undefined,
  traceId: ctx.event.executionId,
});
