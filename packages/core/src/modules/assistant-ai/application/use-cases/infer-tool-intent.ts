import { DateTime } from "luxon";
import { addDurationToNow, parseDateTimeWithZone, parseDurationInput } from "../../../../time.js";
import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ToolAction } from "../../../../pipeline/types.js";

export type DetectedToolIntent = {
  action: ToolAction;
  payload: Record<string, unknown>;
  missing: string[];
  reason: string;
};

export const parseNaturalReminderTime = (
  text: string,
  ctx: PipelineContext
): { remindAt: Date; pretty: string } | null => {
  const lower = text.toLowerCase();
  const durationMatch = lower.match(/(?:daqui|dentro de|em)\s+(\d+)\s*(minutos|min|m|horas|hora|h|dias|dia|d)/i);
  if (durationMatch) {
    const amount = Number.parseInt(durationMatch[1] ?? "0", 10);
    const unit = durationMatch[2] ?? "";
    const token = unit.startsWith("m")
      ? `${amount}m`
      : unit.startsWith("h")
        ? `${amount}h`
        : `${amount}d`;
    const duration = parseDurationInput(token);
    if (duration) {
      const { date, pretty } = addDurationToNow({ durationMs: duration.milliseconds, timezone: ctx.timezone, now: ctx.now });
      return { remindAt: date, pretty };
    }
  }

  const timeRegex = /(?:às|as|a[s]?)\s*(\d{1,2}(?::?\d{2})?)/i;
  const explicitDateMatch = lower.match(/(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/);
  const hasTomorrow = /\bamanh[ãa]\b/.test(lower);
  const hasToday = /\bhoje\b/.test(lower);

  let dateToken: string | undefined;
  if (hasTomorrow || hasToday) {
    const base = DateTime.fromJSDate(ctx.now).setZone(ctx.timezone);
    const dt = hasTomorrow ? base.plus({ days: 1 }) : base;
    dateToken = dt.toFormat("dd-LL-yyyy");
  } else if (explicitDateMatch?.[1]) {
    dateToken = explicitDateMatch[1].replace(/\//g, "-");
  }

  let timeToken: string | undefined;
  const explicitTime = timeRegex.exec(lower);
  const looseTime = lower.match(/(\d{1,2}[:h]\d{1,2})/);
  if (explicitTime?.[1]) timeToken = explicitTime[1].replace("h", ":");
  else if (looseTime?.[1]) timeToken = looseTime[1].replace("h", ":");

  if (dateToken) {
    const parsed = parseDateTimeWithZone({
      dateToken,
      timeToken,
      timezone: ctx.timezone,
      now: ctx.now,
      defaultTime: ctx.defaultReminderTime
    });
    if (parsed) return { remindAt: parsed.date, pretty: parsed.pretty };
  }

  if (timeToken) {
    const todayToken = DateTime.fromJSDate(ctx.now).setZone(ctx.timezone).toFormat("dd-LL-yyyy");
    const parsedToday = parseDateTimeWithZone({
      dateToken: todayToken,
      timeToken,
      timezone: ctx.timezone,
      now: ctx.now,
      defaultTime: ctx.defaultReminderTime
    });
    if (parsedToday) {
      if (parsedToday.date.getTime() <= ctx.now.getTime()) {
        const tomorrowToken = DateTime.fromJSDate(ctx.now).setZone(ctx.timezone).plus({ days: 1 }).toFormat("dd-LL-yyyy");
        const parsedTomorrow = parseDateTimeWithZone({
          dateToken: tomorrowToken,
          timeToken,
          timezone: ctx.timezone,
          now: ctx.now,
          defaultTime: ctx.defaultReminderTime
        });
        if (parsedTomorrow) return { remindAt: parsedTomorrow.date, pretty: parsedTomorrow.pretty };
      }
      return { remindAt: parsedToday.date, pretty: parsedToday.pretty };
    }
  }

  return null;
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
    "update_reminder:reminderId": "Qual o ID do lembrete para editar?",
    "update_reminder:message": "Qual o novo texto do lembrete?",
    "update_reminder:remindAt": "Qual o novo horário do lembrete?",
    "delete_reminder:reminderId": "Qual o ID do lembrete que devo cancelar?"
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

  if (/(lembre|lembra|lembrete)/i.test(lower)) {
    const wantsDelete = /(cancela|cancelar|remover|remove|apaga|exclui)/i.test(lower);
    const wantsUpdate = /(edita|editar|atualiza|muda|alterar|altera)/i.test(lower);
    const reminderId = text.match(/(?:lembrete|id)\s+([a-z0-9-]{6,})/i)?.[1];

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
    const message = text.replace(/^(por favor\s+)?(me\s+)?(lembre|lembra)(-me)?\s*(de|que)?/i, "").trim();
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
