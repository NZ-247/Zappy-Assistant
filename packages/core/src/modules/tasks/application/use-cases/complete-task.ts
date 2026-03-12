import type { TasksRepositoryPort } from "../../ports/tasks-repository.port.js";

export interface CompleteTaskInput {
  tenantId: string;
  taskId: string;
  waGroupId?: string;
  waUserId?: string;
}

export const completeTask = async (tasksRepository: TasksRepositoryPort, input: CompleteTaskInput): Promise<boolean> => {
  return tasksRepository.markDone({
    tenantId: input.tenantId,
    taskId: input.taskId,
    waGroupId: input.waGroupId,
    waUserId: input.waUserId
  });
};
