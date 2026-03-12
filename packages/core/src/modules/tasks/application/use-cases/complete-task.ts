import type { TasksRepositoryPort } from "../../ports/tasks-repository.port.js";

export interface CompleteTaskInput {
  tenantId: string;
  taskRef: string;
  waGroupId?: string;
  waUserId?: string;
}

export interface CompleteTaskResult {
  ok: boolean;
  id?: string;
  publicId?: string;
}

export const completeTask = async (tasksRepository: TasksRepositoryPort, input: CompleteTaskInput): Promise<CompleteTaskResult> => {
  return tasksRepository.markDone({
    tenantId: input.tenantId,
    taskRef: input.taskRef,
    waGroupId: input.waGroupId,
    waUserId: input.waUserId
  });
};
