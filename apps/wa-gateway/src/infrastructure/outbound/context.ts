import type { ExecuteOutboundActionsInput, OutboundScope } from "./types.js";

export const logOutbound = (
  input: ExecuteOutboundActionsInput,
  action: string,
  waMessageId: string,
  text: string,
  scope: OutboundScope,
  responseActionId: string
) => {
  input.logger.info?.(
    input.withCategory("WA-OUT", {
      tenantId: input.event.tenantId,
      scope,
      waUserId: input.waUserId,
      phoneNumber: input.canonical?.phoneNumber,
      normalizedPhone: input.normalizedPhone,
      permissionRole: input.permissionRole,
      relationshipProfile: input.relationshipProfile,
      waGroupId: input.event.waGroupId,
      waMessageId,
      inboundWaMessageId: input.event.waMessageId,
      executionId: input.event.executionId,
      responseActionId,
      action,
      textPreview: text.slice(0, 80)
    }),
    "outbound message"
  );
};

export const buildResponseActionId = (input: ExecuteOutboundActionsInput, action: any, actionIndex: number): string => {
  const baseExecutionId =
    (typeof input.event.executionId === "string" && input.event.executionId.trim().length > 0
      ? input.event.executionId
      : input.event.waMessageId) ?? "noexec";
  return `${baseExecutionId}:a${actionIndex + 1}:${action.kind ?? "unknown"}`;
};

export const buildActionLogContext = (
  input: ExecuteOutboundActionsInput,
  actionName: string,
  scope: OutboundScope,
  responseActionId: string
): Record<string, unknown> => ({
  tenantId: input.event.tenantId,
  scope,
  action: actionName,
  waUserId: input.waUserId,
  waGroupId: input.event.waGroupId,
  inboundWaMessageId: input.event.waMessageId,
  executionId: input.event.executionId,
  responseActionId
});

export const sendTextAndPersist = async (input: {
  runtime: ExecuteOutboundActionsInput;
  to: string;
  text: string;
  actionName: string;
  scope: OutboundScope;
  responseActionId: string;
  content?: any;
  persist?: boolean;
}) => {
  const { runtime, to, text, actionName, scope, responseActionId } = input;
  const sent = await runtime.sendWithReplyFallback({
    to,
    content: input.content ?? { text },
    quotedMessage: runtime.message,
    logContext: buildActionLogContext(runtime, actionName, scope, responseActionId)
  });

  if (input.persist ?? true) {
    await runtime.persistOutboundMessage({
      tenantId: runtime.context.tenant.id,
      userId: runtime.context.user.id,
      groupId: runtime.context.group?.id,
      waUserId: runtime.waUserId,
      waGroupId: runtime.event.waGroupId,
      text,
      waMessageId: sent.key.id,
      rawJson: sent
    });
  }

  logOutbound(runtime, actionName, sent.key.id, text, scope, responseActionId);
  return sent;
};
