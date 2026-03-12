import { formatDateTimeInZone } from "../../../../time.js";
import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { NotesRepositoryPort, RemindersRepositoryPort, TasksRepositoryPort } from "../../../../pipeline/ports.js";
import type { DetectedToolIntent } from "./infer-tool-intent.js";
import { addNote as addNoteUseCase, listNotes as listNotesUseCase } from "../../../notes/index.js";
import {
  completeTask as completeTaskUseCase,
  createTask as createTaskUseCase,
  listTasks as listTasksUseCase,
  removeTask as removeTaskUseCase,
  updateTask as updateTaskUseCase
} from "../../../tasks/index.js";

const truncate = (text: string, max = 60): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export type ToolExecutionDeps = {
  tasksRepository: TasksRepositoryPort;
  remindersRepository: RemindersRepositoryPort;
  notesRepository?: NotesRepositoryPort;
  stylizeReply: (text: string) => string;
  timezone: string;
};

export const executeToolIntent = async (
  ctx: PipelineContext,
  intent: DetectedToolIntent,
  deps: ToolExecutionDeps
): Promise<ResponseAction[]> => {
  switch (intent.action) {
    case "create_task": {
      const title = String(intent.payload.title ?? "").trim();
      const runAtRaw = intent.payload.runAt;
      const runAt = runAtRaw instanceof Date ? runAtRaw : runAtRaw ? new Date(runAtRaw as string) : undefined;
      if (!title) return [{ kind: "reply_text", text: deps.stylizeReply("Qual o título da tarefa?") }];
      const task = await createTaskUseCase(deps.tasksRepository, {
        tenantId: ctx.event.tenantId,
        title,
        createdByWaUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId,
        runAt: runAt ?? null
      });
      return [{ kind: "reply_text", text: deps.stylizeReply(`Tarefa criada: ${task.publicId} - ${task.title}`) }];
    }
    case "list_tasks": {
      const tasks = await listTasksUseCase(deps.tasksRepository, {
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
      if (tasks.length === 0) return [{ kind: "reply_text", text: deps.stylizeReply("Nenhuma tarefa no momento.") }];
      return [
        {
          kind: "reply_list",
          header: "Tarefas",
          items: tasks.map((t) => ({
            title: `${t.done ? "✅" : "⬜"} ${t.publicId}`,
            description: t.title
          }))
        }
      ];
    }
    case "update_task": {
      const taskId = String(intent.payload.taskId ?? "").trim();
      const title = String(intent.payload.title ?? "").trim();
      if (!taskId || !title) {
        const missingField = !taskId ? "taskId" : "title";
        return [{ kind: "reply_text", text: deps.stylizeReply(missingField === "taskId" ? "Qual o ID da tarefa?" : "Qual é o novo título da tarefa?") }];
      }
      const result = await updateTaskUseCase(deps.tasksRepository, {
        tenantId: ctx.event.tenantId,
        taskId,
        title,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
      if (result.status === "not_supported") return [{ kind: "reply_text", text: deps.stylizeReply("Atualização de tarefas não está disponível.") }];
      if (result.status === "not_found") return [{ kind: "reply_text", text: deps.stylizeReply(`Não encontrei a tarefa ${taskId}.`) }];
      return [{ kind: "reply_text", text: deps.stylizeReply(`Tarefa ${result.task.id} atualizada para: ${result.task.title}`) }];
    }
    case "complete_task": {
      const taskRef = String(intent.payload.taskId ?? "").trim();
      if (!taskRef) return [{ kind: "reply_text", text: deps.stylizeReply("Qual o ID da tarefa?") }];
      const done = await completeTaskUseCase(deps.tasksRepository, {
        tenantId: ctx.event.tenantId,
        taskRef,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
      const label = done.publicId ?? taskRef;
      return [{ kind: "reply_text", text: deps.stylizeReply(done.ok ? `Tarefa ${label} marcada como concluída.` : `Tarefa ${taskRef} não encontrada.`) }];
    }
    case "delete_task": {
      const taskId = String(intent.payload.taskId ?? "").trim();
      if (!taskId) return [{ kind: "reply_text", text: deps.stylizeReply("Qual o ID da tarefa?") }];
      const result = await removeTaskUseCase(deps.tasksRepository, {
        tenantId: ctx.event.tenantId,
        taskId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
      if (result.status === "not_supported") return [{ kind: "reply_text", text: deps.stylizeReply("Remoção de tarefas não está disponível.") }];
      return [{ kind: "reply_text", text: deps.stylizeReply(result.status === "removed" ? `Tarefa ${taskId} removida.` : `Não encontrei a tarefa ${taskId}.`) }];
    }
    case "create_reminder": {
      const message = String(intent.payload.message ?? "").trim();
      const remindAtRaw = intent.payload.remindAt;
      const remindAt = remindAtRaw instanceof Date ? remindAtRaw : remindAtRaw ? new Date(remindAtRaw as string) : undefined;
      if (!message) return [{ kind: "reply_text", text: deps.stylizeReply("O que devo te lembrar?") }];
      if (!remindAt || Number.isNaN(remindAt.getTime())) {
        return [{ kind: "reply_text", text: deps.stylizeReply("Quando devo lembrar? Informe data e horário ou duração.") }];
      }
      const reminder = await deps.remindersRepository.createReminder({
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId,
        message,
        remindAt
      });
      const pretty = formatDateTimeInZone(remindAt, deps.timezone);
      return [
        { kind: "reply_text", text: deps.stylizeReply(`Lembrete ${reminder.id} definido para ${pretty}.`) },
        { kind: "enqueue_job", jobType: "reminder", payload: { id: reminder.id, runAt: remindAt } }
      ];
    }
    case "update_reminder": {
      if (!deps.remindersRepository.updateReminder) return [{ kind: "reply_text", text: deps.stylizeReply("Atualização de lembretes não está disponível.") }];
      const reminderId = String(intent.payload.reminderId ?? "").trim();
      const message = intent.payload.message ? String(intent.payload.message).trim() : undefined;
      const remindAtRaw = intent.payload.remindAt;
      const remindAt = remindAtRaw instanceof Date ? remindAtRaw : remindAtRaw ? new Date(remindAtRaw as string) : undefined;
      if (!reminderId) return [{ kind: "reply_text", text: deps.stylizeReply("Qual o ID do lembrete para editar?") }];
      if (!message && !remindAt) {
        return [{ kind: "reply_text", text: deps.stylizeReply("Envie o novo texto ou horário do lembrete.") }];
      }
      const updated = await deps.remindersRepository.updateReminder({
        tenantId: ctx.event.tenantId,
        reminderId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        message,
        remindAt
      });
      if (!updated) return [{ kind: "reply_text", text: deps.stylizeReply(`Não encontrei o lembrete ${reminderId}.`) }];
      const parts: string[] = [];
      if (message) parts.push(`texto atualizado`);
      if (remindAt) parts.push(`novo horário ${formatDateTimeInZone(remindAt, deps.timezone)}`);
      const actions: ResponseAction[] = [
        { kind: "reply_text", text: deps.stylizeReply(`Lembrete ${reminderId} atualizado (${parts.join(" / ")}).`) }
      ];
      if (remindAt) actions.push({ kind: "enqueue_job", jobType: "reminder", payload: { id: reminderId, runAt: remindAt } });
      return actions;
    }
    case "delete_reminder": {
      if (!deps.remindersRepository.deleteReminder) return [{ kind: "reply_text", text: deps.stylizeReply("Cancelamento de lembretes não está disponível.") }];
      const reminderId = String(intent.payload.reminderId ?? "").trim();
      if (!reminderId) return [{ kind: "reply_text", text: deps.stylizeReply("Qual o ID do lembrete que devo cancelar?") }];
      const removed = await deps.remindersRepository.deleteReminder({
        tenantId: ctx.event.tenantId,
        reminderId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
      return [{ kind: "reply_text", text: deps.stylizeReply(removed ? `Lembrete ${reminderId} cancelado.` : `Não encontrei o lembrete ${reminderId}.`) }];
    }
    case "add_note": {
      if (!deps.notesRepository) return [{ kind: "reply_text", text: deps.stylizeReply("O módulo de notas não está disponível.") }];
      const text = String(intent.payload.text ?? "").trim();
      if (!text) return [{ kind: "reply_text", text: deps.stylizeReply("Envie o texto da nota.") }];
      const note = await addNoteUseCase(deps.notesRepository, {
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        text,
        scope: ctx.scope.scope
      });
      return [{ kind: "reply_text", text: deps.stylizeReply(`Nota ${note.publicId} salva.`) }];
    }
    case "list_notes": {
      if (!deps.notesRepository) return [{ kind: "reply_text", text: deps.stylizeReply("O módulo de notas não está disponível.") }];
      const notes = await listNotesUseCase(deps.notesRepository, {
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        scope: ctx.scope.scope,
        limit: 10
      });
      if (notes.length === 0) return [{ kind: "reply_text", text: deps.stylizeReply("Nenhuma nota encontrada.") }];
      return [
        {
          kind: "reply_list",
          header: "Notas",
          items: notes.map((n) => ({ title: n.publicId, description: truncate(n.text, 50) }))
        }
      ];
    }
    case "get_time": {
      const formatted = formatDateTimeInZone(ctx.now, deps.timezone);
      return [{ kind: "reply_text", text: deps.stylizeReply(`Agora são ${formatted} (${deps.timezone}).`) }];
    }
    case "get_settings": {
      const lines = [
        `assistant_mode: ${ctx.flags.assistant_mode ?? "professional"}`,
        `fun_mode: ${ctx.flags.fun_mode ?? "off"}`,
        `downloads_mode: ${ctx.flags.downloads_mode ?? "off"}`,
        `timezone: ${deps.timezone}`
      ];
      return [{ kind: "reply_text", text: deps.stylizeReply(`Configurações atuais:\n${lines.join("\n")}`) }];
    }
    default:
      return [];
  }
};
