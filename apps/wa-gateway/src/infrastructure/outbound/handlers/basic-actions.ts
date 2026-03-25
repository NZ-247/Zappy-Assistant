import { sendTextAndPersist } from "../context.js";
import type { ExecuteOutboundActionsInput } from "../types.js";

export const handleBasicOutboundAction = async (input: {
  runtime: ExecuteOutboundActionsInput;
  action: any;
  responseActionId: string;
}): Promise<boolean> => {
  const { runtime, action, responseActionId } = input;

  if (action.kind === "enqueue_job") {
    const runAt = action.payload.runAt ? new Date(action.payload.runAt) : new Date();
    if (action.jobType === "reminder") {
      await runtime.queueAdapter.enqueueReminder(String(action.payload.id), runAt);
    } else if (action.jobType === "timer") {
      await runtime.queueAdapter.enqueueTimer(String(action.payload.id), runAt);
    } else {
      runtime.logger.warn?.({ jobType: action.jobType, payload: action.payload }, "unknown enqueue_job action");
    }
    return true;
  }

  if (action.kind === "noop") {
    return true;
  }

  if (action.kind === "handoff") {
    const note = action.note ?? "Handoff solicitado.";
    await sendTextAndPersist({
      runtime,
      to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
      text: note,
      actionName: "handoff",
      scope: runtime.isGroup ? "group" : "direct",
      responseActionId
    });
    return true;
  }

  if (action.kind === "ai_tool_suggestion") {
    const textToSend =
      action.text ??
      `Posso executar: ${action.tool.action}. Diga 'ok' para confirmar ou detalhe o que precisa.`;
    await sendTextAndPersist({
      runtime,
      to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
      text: textToSend,
      actionName: "ai_tool_suggestion",
      scope: runtime.isGroup ? "group" : "direct",
      responseActionId
    });
    return true;
  }

  if (action.kind === "reply_audio") {
    let audioBuffer: Buffer;
    try {
      audioBuffer = Buffer.from(action.audioBase64, "base64");
    } catch {
      await sendTextAndPersist({
        runtime,
        to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
        text: "Falha ao preparar áudio para envio.",
        actionName: "reply_audio_error",
        scope: runtime.isGroup ? "group" : "direct",
        responseActionId
      });
      return true;
    }

    if (!audioBuffer.length) {
      await sendTextAndPersist({
        runtime,
        to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
        text: "Áudio TTS vazio. Tente novamente em instantes.",
        actionName: "reply_audio_error",
        scope: runtime.isGroup ? "group" : "direct",
        responseActionId
      });
      return true;
    }

    await sendTextAndPersist({
      runtime,
      to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
      text: action.caption ?? "[audio]",
      actionName: "reply_audio",
      scope: runtime.isGroup ? "group" : "direct",
      responseActionId,
      content: {
        audio: audioBuffer,
        mimetype: action.mimeType,
        ptt: Boolean(action.ptt),
        fileName: action.fileName
      }
    });
    return true;
  }

  if (action.kind === "reply_text" || action.kind === "reply_list") {
    const textToSend =
      action.kind === "reply_text"
        ? action.text
        : [action.header, ...action.items.map((item: any) => `• ${item.title}${item.description ? ` — ${item.description}` : ""}`), action.footer]
            .filter(Boolean)
            .join("\n");
    await sendTextAndPersist({
      runtime,
      to: runtime.isGroup ? runtime.remoteJid : runtime.waUserId,
      text: textToSend,
      actionName: action.kind,
      scope: runtime.isGroup ? "group" : "direct",
      responseActionId
    });
    return true;
  }

  return false;
};
