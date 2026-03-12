import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { ConversationStatePort } from "../../../../pipeline/ports.js";
import { inferToolIntent, promptForMissing } from "./infer-tool-intent.js";
import type { ToolExecutionDeps } from "./execute-tool-intent.js";
import { executeToolIntent } from "./execute-tool-intent.js";
import { setPendingConversationState, clearConversationState } from "../../services/conversation-state-helpers.js";
import type { PendingToolContext } from "../../dto/pending-tool-context.js";

export type HandleAddressedMessageDeps = {
  conversationState?: ConversationStatePort;
  pendingStateTtlMs: number;
  stylizeReply: (text: string) => string;
  toolExecution: ToolExecutionDeps;
};

export const handleAddressedMessage = async (
  ctx: PipelineContext,
  deps: HandleAddressedMessageDeps
): Promise<ResponseAction[]> => {
  if (ctx.groupPolicy?.commandsOnly) return [];
  if (ctx.policyMuted) return [];

  const intent = inferToolIntent(ctx);
  if (!intent) return [];

  if (intent.missing.length > 0) {
    const pending: PendingToolContext = {
      pendingTool: intent.action,
      missing: intent.missing,
      provided: intent.payload,
      summary: intent.reason
    };
    await setPendingConversationState(ctx, deps.conversationState, "WAITING_TOOL_DETAILS", pending, deps.pendingStateTtlMs);
    const question = promptForMissing(intent.action, intent.missing[0]);
    return [{ kind: "reply_text", text: deps.stylizeReply(question) }];
  }

  if (deps.conversationState && (intent.action === "delete_task" || intent.action === "delete_reminder")) {
    const pending: PendingToolContext = {
      pendingTool: intent.action,
      missing: [],
      provided: intent.payload,
      summary: intent.reason
    };
    await setPendingConversationState(ctx, deps.conversationState, "WAITING_TOOL_CONFIRMATION", pending, deps.pendingStateTtlMs);
    const prompt =
      intent.action === "delete_task"
        ? `Confirma remover a tarefa ${intent.payload.taskId}? Responda sim ou não.`
        : `Confirma cancelar o lembrete ${intent.payload.reminderId}? Responda sim ou não.`;
    return [{ kind: "reply_text", text: deps.stylizeReply(prompt) }];
  }

  const actions = await executeToolIntent(ctx, intent, deps.toolExecution);
  if (actions.length > 0) await clearConversationState(ctx, deps.conversationState);
  return actions;
};
