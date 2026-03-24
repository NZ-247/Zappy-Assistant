import type { TasksRepositoryPort } from "../../ports.js";

export interface CreateTaskInput {
  tenantId: string;
  title: string;
  createdByWaUserId: string;
  waGroupId?: string;
  runAt?: Date | null;
}

export interface CreateTaskResult {
  id: string;
  publicId: string;
  title: string;
  runAt?: Date | null;
}

export const createTask = async (tasksRepository: TasksRepositoryPort, input: CreateTaskInput): Promise<CreateTaskResult> => {
  return tasksRepository.addTask({
    tenantId: input.tenantId,
    title: input.title,
    createdByWaUserId: input.createdByWaUserId,
    waGroupId: input.waGroupId,
    runAt: input.runAt
  });
};
