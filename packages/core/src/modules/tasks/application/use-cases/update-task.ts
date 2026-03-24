import type { TasksRepositoryPort } from "../../ports.js";

export interface UpdateTaskInput {
  tenantId: string;
  taskId: string;
  title?: string;
  runAt?: Date | null;
  waGroupId?: string;
  waUserId?: string;
}

export type UpdateTaskResult =
  | { status: "updated"; task: { id: string; title: string; runAt?: Date | null } }
  | { status: "not_found" }
  | { status: "not_supported" };

export const updateTask = async (tasksRepository: TasksRepositoryPort, input: UpdateTaskInput): Promise<UpdateTaskResult> => {
  if (!tasksRepository.updateTask) return { status: "not_supported" };
  const updated = await tasksRepository.updateTask({
    tenantId: input.tenantId,
    taskId: input.taskId,
    title: input.title,
    runAt: input.runAt,
    waGroupId: input.waGroupId,
    waUserId: input.waUserId
  });
  if (!updated) return { status: "not_found" };
  return { status: "updated", task: updated };
};
