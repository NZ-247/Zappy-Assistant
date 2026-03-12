import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { ConversationStatePort } from "../../../../pipeline/ports.js";
import type { ConversationState } from "../../../../pipeline/types.js";
import { formatCommand } from "../../../../commands/parser/prefix.js";
import { parseNaturalReminderTime, promptForMissing } from "./infer-tool-intent.js";
import { getPendingContext, setPendingConversationState, clearConversationState } from "../../services/conversation-state-helpers.js";
import type { PendingToolContext } from "../../dto/pending-tool-context.js";
import type { ToolExecutionDeps } from "./execute-tool-intent.js";
import { executeToolIntent } from "./execute-tool-intent.js";

const isCancelText = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  const tokens = ["cancel", "cancela", "cancelar", "pare", "para", "esquece", "reset", "resetar"];
  return tokens.some((t) => normalized === t || normalized.startsWith(`${t} `));
};

const buildAwaitingStateText = (state: ConversationState, commandPrefix: string): string => {
  switch (state) {
    case "WAITING_CONFIRMATION":
      return "Ainda estou aguardando sua confirmação. Responda com 'sim' ou 'não'.";
    case "WAITING_TASK_DETAILS":
      return `Preciso dos detalhes da tarefa para continuar. Envie o título ou use ${formatCommand(commandPrefix, "task add <título>")}.`;
    case "WAITING_REMINDER_DETAILS":
      return `Envie o texto do lembrete ou use ${formatCommand(commandPrefix, "reminder in <duração> <mensagem>")}.`;
    case "WAITING_TOOL_DETAILS":
      return "Faltam alguns detalhes. Pode completar a informação para eu seguir?";
    case "WAITING_TOOL_CONFIRMATION":
      return "Quase lá. Confirma que devo executar?";
    case "WAITING_CONSENT":
      return "Preciso que você aceite os termos primeiro. Responda SIM para aceitar ou NÃO para recusar.";
    case "HANDOFF_ACTIVE":
      return "O atendimento humano já foi acionado. Aguarde, por favor.";
    default:
      return "Estou aguardando mais informações para continuar.";
  }
};

export type RunSlotFillingDeps = {
  conversationState?: ConversationStatePort;
  pendingStateTtlMs: number;
  stylizeReply: (text: string) => string;
  toolExecution: ToolExecutionDeps;
  commandPrefix: string;
};

export const runSlotFilling = async (ctx: PipelineContext, deps: RunSlotFillingDeps): Promise<ResponseAction[]> => {
  const pending = getPendingContext(ctx.conversationState);
  if (!pending) {
    await clearConversationState(ctx, deps.conversationState);
    return [{ kind: "reply_text", text: deps.stylizeReply(buildAwaitingStateText(ctx.conversationState.state, deps.commandPrefix)) }];
  }

  if (isCancelText(ctx.event.normalizedText)) {
    await clearConversationState(ctx, deps.conversationState);
    return [{ kind: "reply_text", text: deps.stylizeReply("Tudo bem, cancelei o fluxo.") }];
  }

  if (ctx.conversationState.state === "WAITING_TOOL_CONFIRMATION") {
    const yes = /^(sim|pode|ok|okay|claro|yes)/i.test(ctx.event.normalizedText.trim());
    if (!yes) {
      await clearConversationState(ctx, deps.conversationState);
      return [{ kind: "reply_text", text: deps.stylizeReply("Ok, não fiz nenhuma alteração.") }];
    }
    const intent = {
      action: pending.pendingTool,
      payload: pending.provided ?? {},
      missing: [] as string[],
      reason: pending.summary ?? "confirmation"
    };
    const actions = await executeToolIntent(ctx, intent, deps.toolExecution);
    await clearConversationState(ctx, deps.conversationState);
    return actions;
  }

  const payload: Record<string, unknown> = { ...(pending.provided ?? {}) };
  let missing = [...pending.missing];
  const text = ctx.event.normalizedText.trim();
  const idRegex = /[A-Za-z0-9-]{6,}/;

  switch (pending.pendingTool) {
    case "create_task":
      if (missing.includes("title") && text) {
        payload.title = text;
        missing = missing.filter((f) => f !== "title");
      }
      break;
    case "update_task":
      if (missing.includes("taskId") && idRegex.test(text)) {
        payload.taskId = text;
        missing = missing.filter((f) => f !== "taskId");
      }
      if (missing.includes("title") && text) {
        payload.title = text;
        missing = missing.filter((f) => f !== "title");
      }
      break;
    case "complete_task":
    case "delete_task":
      if (missing.includes("taskId") && idRegex.test(text)) {
        payload.taskId = text;
        missing = [];
      }
      break;
    case "create_reminder": {
      if (missing.includes("message") && text) {
        payload.message = text;
        missing = missing.filter((f) => f !== "message");
      }
      if (missing.includes("remindAt")) {
        const parsed = parseNaturalReminderTime(text, ctx);
        if (parsed) {
          payload.remindAt = parsed.remindAt;
          missing = missing.filter((f) => f !== "remindAt");
        }
      }
      break;
    }
    case "update_reminder": {
      if (missing.includes("reminderId") && idRegex.test(text)) {
        payload.reminderId = text;
        missing = missing.filter((f) => f !== "reminderId");
      }
      if (missing.includes("message") && text) {
        payload.message = text;
        missing = missing.filter((f) => f !== "message");
      }
      if (missing.includes("remindAt")) {
        const parsed = parseNaturalReminderTime(text, ctx);
        if (parsed) {
          payload.remindAt = parsed.remindAt;
          missing = missing.filter((f) => f !== "remindAt");
        }
      }
      break;
    }
    default:
      break;
  }

  if (missing.length > 0) {
    const pendingCtx: PendingToolContext = {
      pendingTool: pending.pendingTool,
      missing,
      provided: payload,
      summary: pending.summary
    };
    await setPendingConversationState(ctx, deps.conversationState, "WAITING_TOOL_DETAILS", pendingCtx, deps.pendingStateTtlMs);
    const question = promptForMissing(pending.pendingTool, missing[0]);
    return [{ kind: "reply_text", text: deps.stylizeReply(question) }];
  }

  const intent = {
    action: pending.pendingTool,
    payload,
    missing: [] as string[],
    reason: pending.summary ?? "follow_up"
  };
  const actions = await executeToolIntent(ctx, intent, deps.toolExecution);
  await clearConversationState(ctx, deps.conversationState);
  return actions;
};
