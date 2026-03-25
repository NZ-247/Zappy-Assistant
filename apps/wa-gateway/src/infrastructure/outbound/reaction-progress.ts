import type { ExecuteOutboundActionsInput } from "./types.js";

const resolveInboundMessageKey = (
  runtime: ExecuteOutboundActionsInput
): { id: string; remoteJid?: string; fromMe?: boolean; participant?: string } | null => {
  const fromMessage = runtime.message?.key;
  const fromEvent = runtime.event?.messageKey;
  const id = fromMessage?.id ?? fromEvent?.id;
  if (!id) return null;
  return {
    id,
    remoteJid: fromMessage?.remoteJid ?? fromEvent?.remoteJid ?? runtime.remoteJid,
    fromMe: fromMessage?.fromMe ?? fromEvent?.fromMe ?? false,
    participant: fromMessage?.participant ?? fromEvent?.participant
  };
};

export const sendActionReactionBestEffort = async (input: {
  runtime: ExecuteOutboundActionsInput;
  emoji?: string;
  reactionPhase: "start" | "success" | "failure";
  reactionAction: string;
  responseActionId: string;
}): Promise<boolean> => {
  const { runtime, emoji, reactionPhase, reactionAction, responseActionId } = input;
  if (!emoji?.trim()) return false;
  const socket = runtime.getSocket();
  if (!socket) return false;
  const key = resolveInboundMessageKey(runtime);
  if (!key) {
    runtime.logger.debug?.(
      runtime.withCategory("WA-OUT", {
        tenantId: runtime.event.tenantId,
        waGroupId: runtime.event.waGroupId,
        waUserId: runtime.waUserId,
        inboundWaMessageId: runtime.event.waMessageId,
        executionId: runtime.event.executionId,
        responseActionId,
        action: reactionAction,
        capability: "reactions",
        reactionPhase,
        status: "skipped",
        reason: "inbound_message_key_missing"
      }),
      "reaction skipped"
    );
    return false;
  }

  try {
    await socket.sendMessage(runtime.remoteJid, {
      react: {
        text: emoji,
        key
      }
    });
    return true;
  } catch (error) {
    runtime.logger.debug?.(
      runtime.withCategory("WA-OUT", {
        tenantId: runtime.event.tenantId,
        waGroupId: runtime.event.waGroupId,
        waUserId: runtime.waUserId,
        inboundWaMessageId: runtime.event.waMessageId,
        executionId: runtime.event.executionId,
        responseActionId,
        action: reactionAction,
        capability: "reactions",
        reactionPhase,
        status: "failure",
        err: error
      }),
      "reaction send failed"
    );
    return false;
  }
};

export const createProgressReactionLifecycle = (input: {
  runtime: ExecuteOutboundActionsInput;
  responseActionId: string;
  actionName: string;
  enabled?: boolean;
}) => {
  const { runtime, responseActionId, actionName } = input;
  const enabled = runtime.progressReactions.enabled && (input.enabled ?? true);
  return {
    start: async () => {
      if (!enabled) return false;
      return sendActionReactionBestEffort({
        runtime,
        emoji: runtime.progressReactions.processingEmoji,
        reactionPhase: "start",
        reactionAction: actionName,
        responseActionId
      });
    },
    success: async () => {
      if (!enabled) return false;
      return sendActionReactionBestEffort({
        runtime,
        emoji: runtime.progressReactions.successEmoji,
        reactionPhase: "success",
        reactionAction: actionName,
        responseActionId
      });
    },
    failure: async () => {
      if (!enabled) return false;
      return sendActionReactionBestEffort({
        runtime,
        emoji: runtime.progressReactions.failureEmoji,
        reactionPhase: "failure",
        reactionAction: actionName,
        responseActionId
      });
    }
  };
};
