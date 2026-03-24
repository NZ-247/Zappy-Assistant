import type { TasksRepositoryPort } from "../../ports.js";

export interface RemoveTaskInput {
  tenantId: string;
  taskId: string;
  waGroupId?: string;
  waUserId?: string;
}

export type RemoveTaskResult = { status: "removed" | "not_found" | "not_supported" };

export const removeTask = async (tasksRepository: TasksRepositoryPort, input: RemoveTaskInput): Promise<RemoveTaskResult> => {
  if (!tasksRepository.deleteTask) return { status: "not_supported" };
  const removed = await tasksRepository.deleteTask({
    tenantId: input.tenantId,
    taskId: input.taskId,
    waGroupId: input.waGroupId,
    waUserId: input.waUserId
  });
  return { status: removed ? "removed" : "not_found" };
};
