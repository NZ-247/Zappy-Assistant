import type { TasksRepositoryPort, TaskListItem } from "../../ports.js";

export interface ListTasksInput {
  tenantId: string;
  waGroupId?: string;
  waUserId?: string;
}

export const listTasks = async (tasksRepository: TasksRepositoryPort, input: ListTasksInput): Promise<TaskListItem[]> => {
  return tasksRepository.listTasks({
    tenantId: input.tenantId,
    waGroupId: input.waGroupId,
    waUserId: input.waUserId
  });
};
