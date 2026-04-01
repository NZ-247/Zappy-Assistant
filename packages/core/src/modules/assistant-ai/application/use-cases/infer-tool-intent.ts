import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ToolAction } from "../../../../pipeline/types.js";
import { extractNaturalReminderMessage, parseNaturalReminderTimeFromText } from "../../../reminders/infrastructure/natural-reminder-parser.js";

export type DetectedToolIntent = {
  action: ToolAction;
  payload: Record<string, unknown>;
  missing: string[];
  reason: string;
};

const reminderPublicIdRegex = /\b(RMD[0-9A-Z]{3,})\b/i;
const uuidRegex = /\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i;
const extractReminderRef = (text: string): string | undefined => {
  const publicId = text.match(reminderPublicIdRegex)?.[1];
  if (publicId) return publicId.toUpperCase();
  const uuid = text.match(uuidRegex)?.[1];
  if (uuid) return uuid;
  return text.match(/(?:lembrete|id)\s+([a-z0-9-]{6,})/i)?.[1]?.trim();
};

export const parseNaturalReminderTime = (
  text: string,
  ctx: PipelineContext
): { remindAt: Date; pretty: string } | null => {
  const parsed = parseNaturalReminderTimeFromText({
    text,
    now: ctx.now,
    timezone: ctx.timezone,
    defaultReminderTime: ctx.defaultReminderTime
  });
  if (!parsed) return null;
  return { remindAt: parsed.remindAt, pretty: parsed.pretty };
};

export const promptForMissing = (action: ToolAction, field: string): string => {
  const map: Record<string, string> = {
    "create_task:title": "Qual o título da tarefa?",
    "update_task:taskId": "Qual o ID da tarefa que devo atualizar?",
    "update_task:title": "Qual é o novo título da tarefa?",
    "complete_task:taskId": "Qual o ID da tarefa que devo marcar como concluída?",
    "delete_task:taskId": "Qual o ID da tarefa que devo remover?",
    "create_reminder:message": "O que devo te lembrar?",
    "create_reminder:remindAt": "Quando devo lembrar? Informe data e horário ou duração.",
    "update_reminder:reminderId": "Qual o ID do lembrete para editar? (ex: RMD001)",
    "update_reminder:message": "Qual o novo texto do lembrete?",
    "update_reminder:remindAt": "Qual o novo horário do lembrete?",
    "delete_reminder:reminderId": "Qual o ID do lembrete que devo cancelar? (ex: RMD001)"
  };
  return map[`${action}:${field}`] ?? "Me envia mais detalhes para continuar.";
};

export const inferToolIntent = (ctx: PipelineContext): DetectedToolIntent | null => {
  const text = ctx.event.normalizedText;
  if (!text || text.startsWith("/")) return null;
  const lower = text.toLowerCase();
  if (lower.length < 4) return null;

  if (/(que horas|qual horário|que hora)/i.test(lower)) {
    return { action: "get_time", payload: {}, missing: [], reason: "time_question" };
  }

  if (/(configurações?|preferências?|settings?)/i.test(lower)) {
    return { action: "get_settings", payload: {}, missing: [], reason: "settings_request" };
  }

  if (/(listar|lista|mostra|mostre).*(notas|anotações|notes)/i.test(lower)) {
    return { action: "list_notes", payload: {}, missing: [], reason: "list_notes" };
  }

  if (/(anota|anotar|nota isso|nota ai|note)/i.test(lower)) {
    const noteText = text.replace(/.*?(anota(r)?|nota|note)\s*(que)?/i, "").trim();
    const missing = noteText ? [] : ["text"];
    return { action: "add_note", payload: { text: noteText }, missing, reason: "add_note" };
  }

  const hasReminderKeyword = /(lembre|lembra|lembrete)/i.test(lower);
  const hasReminderRef = reminderPublicIdRegex.test(text) || uuidRegex.test(text);
  const hasReminderOperationVerb = /(cancela|cancelar|remover|remove|apaga|exclui|edita|editar|atualiza|muda|alterar|altera)/i.test(lower);

  if (hasReminderKeyword || (hasReminderRef && hasReminderOperationVerb)) {
    const wantsDelete = /(cancela|cancelar|remover|remove|apaga|exclui)/i.test(lower);
    const wantsUpdate = /(edita|editar|atualiza|muda|alterar|altera)/i.test(lower);
    const reminderId = extractReminderRef(text);

    if (wantsDelete) {
      const missing = reminderId ? [] : ["reminderId"];
      return { action: "delete_reminder", payload: { reminderId: reminderId?.trim() }, missing, reason: "delete_reminder" };
    }

    if (wantsUpdate) {
      const payload: Record<string, unknown> = { reminderId: reminderId?.trim() };
      const time = parseNaturalReminderTime(text, ctx);
      if (time) payload.remindAt = time.remindAt;
      const message = text.replace(/.*?(lembre|lembra|lembrete)/i, "").trim();
      if (message) payload.message = message;
      const missing: string[] = [];
      if (!payload.reminderId) missing.push("reminderId");
      if (!payload.message && !payload.remindAt) missing.push("message");
      return { action: "update_reminder", payload, missing, reason: "update_reminder" };
    }

    const time = parseNaturalReminderTime(text, ctx);
    const message = extractNaturalReminderMessage(text);
    const payload: Record<string, unknown> = { message, remindAt: time?.remindAt, pretty: time?.pretty };
    const missing: string[] = [];
    if (!payload.message) missing.push("message");
    if (!payload.remindAt) missing.push("remindAt");
    return { action: "create_reminder", payload, missing, reason: "create_reminder" };
  }

  if (/(tarefa|task)/i.test(lower)) {
    const wantsDelete = /(remove|remover|apaga|apagar|exclui|deleta|deletar)/i.test(lower);
    const wantsUpdate = /(edita|editar|atualiza|muda|alterar|altera)/i.test(lower);
    const wantsComplete = /(conclu[ií]d|finaliza|finalizar|feito|feita|fechar|encerrar)/i.test(lower);
    const wantsList = /(lista|listar|mostra|quais).*(tarefas|tasks?)/i.test(lower);
    if (wantsList) return { action: "list_tasks", payload: {}, missing: [], reason: "list_tasks" };

    const taskId =
      text.match(/tarefa\s+([A-Za-z0-9-]{6,})/i)?.[1]?.trim() ??
      text.match(/\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i)?.[1];
    const titleSegment = text.split(/tarefa/i)[1]?.replace(/^(de|para|sobre)\s+/i, "").trim() ?? "";

    if (wantsDelete) {
      const missing = taskId ? [] : ["taskId"];
      return { action: "delete_task", payload: { taskId }, missing, reason: "delete_task" };
    }

    if (wantsUpdate) {
      const payload: Record<string, unknown> = { taskId, title: titleSegment };
      const missing: string[] = [];
      if (!taskId) missing.push("taskId");
      if (!payload.title) missing.push("title");
      return { action: "update_task", payload, missing, reason: "update_task" };
    }

    if (wantsComplete) {
      const missing = taskId ? [] : ["taskId"];
      return { action: "complete_task", payload: { taskId }, missing, reason: "complete_task" };
    }

    const payload: Record<string, unknown> = { title: titleSegment };
    const missing: string[] = [];
    if (!payload.title) missing.push("title");
    return { action: "create_task", payload, missing, reason: "create_task" };
  }

  if (/(notas|notes|anotações)/i.test(lower) && /(lista|listar|mostra|quais)/i.test(lower)) {
    return { action: "list_notes", payload: {}, missing: [], reason: "list_notes" };
  }

  return null;
};
