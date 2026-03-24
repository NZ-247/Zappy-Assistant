import { TaskStatus, type Prisma, type Task, type PrismaClient } from "@prisma/client";
import { createPublicIdCodec } from "../infrastructure/public-id.js";
import type { ScopedResolver } from "../shared/scoped-resolver.js";

export interface TasksRepositoryDeps {
  prisma: PrismaClient;
  resolveScopedUserAndGroup: ScopedResolver;
}

const taskPublicIdCodec = createPublicIdCodec("TSK");

const taskScopeWhere = (input: { tenantId: string; waGroupId?: string; waUserId?: string }): Prisma.TaskWhereInput => ({
  tenantId: input.tenantId,
  type: "TASK",
  waGroupId: input.waGroupId ?? undefined,
  waUserId: input.waGroupId ? undefined : input.waUserId
});

const nextTaskSequence = async (prisma: PrismaClient, where: Prisma.TaskWhereInput): Promise<number> => {
  const last = await prisma.task.findFirst({ where, orderBy: { createdAt: "desc" }, select: { payload: true } });
  const lastSeq = Number((last?.payload as Prisma.JsonObject | null)?.sequence ?? 0);
  if (Number.isFinite(lastSeq) && lastSeq > 0) return lastSeq + 1;
  const count = await prisma.task.count({ where });
  return count + 1;
};

const buildTaskPublicId = (row: Task): string => {
  const payload = row.payload as Prisma.JsonObject | null;
  const stored = taskPublicIdCodec.normalize((payload?.publicId as string | undefined) ?? null);
  const seq = Number(payload?.sequence ?? 0);
  if (stored) return stored;
  if (Number.isFinite(seq) && seq > 0) return taskPublicIdCodec.formatFromSequence(seq);
  return taskPublicIdCodec.fallbackFromRecordId(row.id);
};

export const createTasksRepository = (deps: TasksRepositoryDeps) => {
  const { prisma, resolveScopedUserAndGroup } = deps;

  return {
    addTask: async (input: { tenantId: string; title: string; createdByWaUserId: string; waGroupId?: string; runAt?: Date | null }) => {
      const { user, group } = await resolveScopedUserAndGroup({
        tenantId: input.tenantId,
        waUserId: input.createdByWaUserId,
        waGroupId: input.waGroupId
      });
      const where = taskScopeWhere({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.createdByWaUserId });
      const sequence = await nextTaskSequence(prisma, where);
      const publicId = taskPublicIdCodec.formatFromSequence(sequence);
      const payload: Prisma.JsonObject = { title: input.title, createdByWaUserId: input.createdByWaUserId, publicId, sequence };
      const row = await prisma.task.create({
        data: {
          tenantId: input.tenantId,
          groupId: group?.id,
          userId: user?.id,
          waGroupId: input.waGroupId,
          waUserId: input.createdByWaUserId,
          type: "TASK",
          payload,
          status: TaskStatus.PENDING,
          runAt: input.runAt ?? null
        }
      });
      return { id: row.id, publicId, title: input.title };
    },

    listTasks: async (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => {
      const where = taskScopeWhere(input);
      const rows = await prisma.task.findMany({ where, orderBy: { createdAt: "desc" }, take: 20 });
      return rows.map((row) => ({
        id: row.id,
        publicId: buildTaskPublicId(row),
        title: String((row.payload as Prisma.JsonObject).title ?? "untitled"),
        done: row.status === TaskStatus.DONE,
        runAt: row.runAt
      }));
    },

    listTasksForDay: async (input: { tenantId: string; waGroupId?: string; waUserId?: string; dayStart: Date; dayEnd: Date }) => {
      const where: Prisma.TaskWhereInput = {
        ...taskScopeWhere(input),
        OR: [
          { runAt: { gte: input.dayStart, lte: input.dayEnd } },
          { AND: [{ runAt: null }, { createdAt: { gte: input.dayStart, lte: input.dayEnd } }] }
        ]
      };
      const rows = await prisma.task.findMany({ where, orderBy: { createdAt: "asc" }, take: 50 });
      return rows.map((row) => ({
        id: row.id,
        publicId: buildTaskPublicId(row),
        title: String((row.payload as Prisma.JsonObject).title ?? "untitled"),
        done: row.status === TaskStatus.DONE,
        runAt: row.runAt
      }));
    },

    markDone: async (input: { tenantId: string; taskRef: string; waGroupId?: string; waUserId?: string }) => {
      const scope = taskScopeWhere(input);
      const normalizedRef = input.taskRef.trim();
      const normalizedPublicId = taskPublicIdCodec.normalize(normalizedRef);
      const parsedTaskSequence = normalizedPublicId ? taskPublicIdCodec.parseSequence(normalizedPublicId) : null;

      let row =
        (await prisma.task.findFirst({ where: { ...scope, id: normalizedRef } })) ??
        (normalizedPublicId
          ? await prisma.task.findFirst({
              where: {
                ...scope,
                OR: [
                  { payload: { path: ["publicId"], equals: normalizedPublicId } },
                  parsedTaskSequence !== null ? { payload: { path: ["sequence"], equals: parsedTaskSequence } } : undefined
                ].filter(Boolean) as Prisma.TaskWhereInput[]
              }
            })
          : null);

      if (!row && normalizedPublicId) {
        const rows = await prisma.task.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 50 });
        row = rows.find((candidate) => buildTaskPublicId(candidate) === normalizedPublicId) ?? null;
      }
      if (!row) return { ok: false };

      const publicId = buildTaskPublicId(row);
      const payload = { ...(row.payload as Prisma.JsonObject | null), publicId };
      await prisma.task.update({ where: { id: row.id }, data: { status: TaskStatus.DONE, payload } });
      return { ok: true, id: row.id, publicId };
    },

    updateTask: async (input: { tenantId: string; taskId: string; title?: string; runAt?: Date | null; waGroupId?: string; waUserId?: string }) => {
      const row = await prisma.task.findFirst({
        where: {
          id: input.taskId,
          tenantId: input.tenantId,
          type: "TASK",
          waGroupId: input.waGroupId ?? undefined,
          waUserId: input.waGroupId ? undefined : input.waUserId
        }
      });
      if (!row) return null;
      const payload = { ...(row.payload as Prisma.JsonObject), ...(input.title ? { title: input.title } : {}) };
      const data: Prisma.TaskUpdateInput = { payload };
      if (input.runAt !== undefined) data.runAt = input.runAt;
      const updated = await prisma.task.update({ where: { id: row.id }, data });
      return { id: updated.id, title: String((payload as Prisma.JsonObject).title ?? row.id), runAt: updated.runAt };
    },

    deleteTask: async (input: { tenantId: string; taskId: string; waGroupId?: string; waUserId?: string }) => {
      const row = await prisma.task.findFirst({
        where: {
          id: input.taskId,
          tenantId: input.tenantId,
          type: "TASK",
          waGroupId: input.waGroupId ?? undefined,
          waUserId: input.waGroupId ? undefined : input.waUserId
        }
      });
      if (!row) return false;
      await prisma.task.delete({ where: { id: row.id } });
      return true;
    },

    countOpen: async (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => {
      const where: Prisma.TaskWhereInput = {
        tenantId: input.tenantId,
        type: "TASK",
        waGroupId: input.waGroupId ?? undefined,
        waUserId: input.waGroupId ? undefined : input.waUserId,
        status: { not: TaskStatus.DONE }
      };
      return prisma.task.count({ where });
    }
  };
};
