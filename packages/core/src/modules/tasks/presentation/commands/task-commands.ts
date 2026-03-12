import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { TasksRepositoryPort } from "../../ports/tasks-repository.port.js";
import { createTask } from "../../application/use-cases/create-task.js";
import { listTasks } from "../../application/use-cases/list-tasks.js";
import { completeTask } from "../../application/use-cases/complete-task.js";

type TaskCommandKey = "task add" | "task list" | "task done";

export interface TaskCommandDeps {
  tasksRepository: TasksRepositoryPort;
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
    const title = cmd.replace(/^(task add)\s+/i, "").trim();
    if (!title) return [{ kind: "reply_text", text: "Task title is required." }];
    const task = await createTask(tasksRepository, {
      tenantId: ctx.event.tenantId,
      title,
      createdByWaUserId: ctx.event.waUserId,
      waGroupId: ctx.event.waGroupId
    });
    return [{ kind: "reply_text", text: `Task created: ${task.id} - ${task.title}` }];
  }

  if (key === "task list") {
    const tasks = await listTasks(tasksRepository, {
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId
    });
    if (tasks.length === 0) return [{ kind: "reply_text", text: "No tasks yet." }];
    return [
      {
        kind: "reply_list",
        header: "Tarefas",
        items: tasks.map((t) => ({
          title: `${t.done ? "✅" : "⬜"} ${t.id}`,
          description: t.title
        }))
      }
    ];
  }

  if (key === "task done") {
    const taskId = cmd.replace(/^(task done)\s+/i, "").trim();
    const done = await completeTask(tasksRepository, {
      tenantId: ctx.event.tenantId,
      taskId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId
    });
    return [{ kind: "reply_text", text: done ? `Task ${taskId} marked done.` : `Task ${taskId} not found.` }];
  }

  return null;
};
