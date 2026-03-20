import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { TasksRepositoryPort } from "../../ports/tasks-repository.port.js";
import { createTask } from "../../application/use-cases/create-task.js";
import { listTasks } from "../../application/use-cases/list-tasks.js";
import { completeTask } from "../../application/use-cases/complete-task.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicIdPattern = /^TSK[0-9A-Z]{3,}$/i;
const isValidTaskRef = (value: string): boolean => uuidPattern.test(value.trim()) || publicIdPattern.test(value.trim().toUpperCase());

type TaskCommandKey = "task add" | "task list" | "task done";

export interface TaskCommandDeps {
  tasksRepository: TasksRepositoryPort;
  formatUsage?: (command: TaskCommandKey) => string | null;
}

export const handleTaskCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: TaskCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps } = input;
  if (!["task add", "task list", "task done"].includes(commandKey)) return null;

  const tasksRepository = deps.tasksRepository;
  const key = commandKey as TaskCommandKey;

  if (key === "task add") {
    const usage = deps.formatUsage?.("task add");
    const title = cmd.replace(/^task\s+add\b/i, "").trim();
    if (!title) return [{ kind: "reply_text", text: usage ?? "Uso correto: task add <título>" }];
    const task = await createTask(tasksRepository, {
      tenantId: ctx.event.tenantId,
      title,
      createdByWaUserId: ctx.event.waUserId,
      waGroupId: ctx.event.waGroupId
    });
    return [{ kind: "reply_text", text: `Tarefa criada: ${task.publicId} - ${task.title}` }];
  }

  if (key === "task list") {
    const tasks = await listTasks(tasksRepository, {
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId
    });
    if (tasks.length === 0) return [{ kind: "reply_text", text: "Nenhuma tarefa encontrada." }];
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

  if (key === "task done") {
    const usage = deps.formatUsage?.("task done");
    const args = cmd.replace(/^task\s+done\b/i, "").trim();
    if (!args) return [{ kind: "reply_text", text: usage ?? "Uso correto: task done <id>" }];
    const taskId = (args.split(/\s+/).find(Boolean) ?? "").trim();
    if (!taskId) return [{ kind: "reply_text", text: usage ?? "Uso correto: task done <id>" }];
    if (!isValidTaskRef(taskId)) return [{ kind: "reply_text", text: "ID de tarefa inválido. Use um UUID ou ID público (ex: TSK001)." }];
    const done = await completeTask(tasksRepository, {
      tenantId: ctx.event.tenantId,
      taskRef: taskId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId
    });
    const label = done.publicId ?? taskId;
    if (!done.ok) return [{ kind: "reply_text", text: "Tarefa não encontrada." }];
    return [{ kind: "reply_text", text: `Tarefa ${label} marcada como concluída.` }];
  }

  return null;
};
