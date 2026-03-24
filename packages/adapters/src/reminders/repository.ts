import { ReminderStatus, type Prisma, type Reminder, type PrismaClient } from "@prisma/client";
import type { ReminderCreateInput } from "@zappy/core";
import { createPublicIdCodec } from "../infrastructure/public-id.js";
import type { ScopedResolver } from "../shared/scoped-resolver.js";

export interface RemindersRepositoryDeps {
  prisma: PrismaClient;
  resolveScopedUserAndGroup: ScopedResolver;
}

const reminderPublicIdCodec = createPublicIdCodec("RMD", { strictNumericSequence: true });

const reminderScopeWhere = (input: { tenantId: string; waGroupId?: string; waUserId?: string }): Prisma.ReminderWhereInput => ({
  tenantId: input.tenantId,
  waGroupId: input.waGroupId ?? undefined,
  waUserId: input.waGroupId ? undefined : input.waUserId
});

const nextReminderSequence = async (prisma: PrismaClient, input: { tenantId: string }): Promise<number> => {
  const last = await prisma.reminder.findFirst({
    where: { tenantId: input.tenantId },
    orderBy: [{ sequence: "desc" }, { createdAt: "desc" }],
    select: { sequence: true }
  });
  const lastSeq = Number(last?.sequence ?? 0);
  if (Number.isFinite(lastSeq) && lastSeq > 0) return lastSeq + 1;
  const count = await prisma.reminder.count({ where: { tenantId: input.tenantId } });
  return count + 1;
};

const buildReminderPublicId = (row: Pick<Reminder, "id" | "publicId" | "sequence">): string => {
  const stored = reminderPublicIdCodec.normalize(row.publicId);
  if (stored) return stored;
  const seq = Number(row.sequence ?? 0);
  if (Number.isFinite(seq) && seq > 0) return reminderPublicIdCodec.formatFromSequence(seq);
  return reminderPublicIdCodec.fallbackFromRecordId(row.id);
};

const findReminderByRef = async (
  prisma: PrismaClient,
  input: { tenantId: string; reminderRef: string; waGroupId?: string; waUserId?: string }
): Promise<Reminder | null> => {
  const scope = reminderScopeWhere(input);
  const ref = input.reminderRef.trim();
  if (!ref) return null;
  const normalizedPublicId = reminderPublicIdCodec.normalize(ref);
  const parsedSequence = normalizedPublicId ? reminderPublicIdCodec.parseSequence(normalizedPublicId) : null;
  const whereByRef: Prisma.ReminderWhereInput[] = [{ id: ref }];
  if (normalizedPublicId) whereByRef.push({ publicId: normalizedPublicId });
  if (parsedSequence !== null) whereByRef.push({ sequence: parsedSequence });

  let row = await prisma.reminder.findFirst({
    where: {
      ...scope,
      OR: whereByRef
    }
  });
  if (row) return row;

  if (normalizedPublicId) {
    const recent = await prisma.reminder.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 200 });
    row = recent.find((candidate) => buildReminderPublicId(candidate) === normalizedPublicId) ?? null;
  }
  return row;
};

export const createRemindersRepository = (deps: RemindersRepositoryDeps) => {
  const { prisma, resolveScopedUserAndGroup } = deps;

  return {
    createReminder: async (input: ReminderCreateInput) => {
      const { user, group } = await resolveScopedUserAndGroup({
        tenantId: input.tenantId,
        waUserId: input.waUserId,
        waGroupId: input.waGroupId
      });
      const sequence = await nextReminderSequence(prisma, { tenantId: input.tenantId });
      const publicId = reminderPublicIdCodec.formatFromSequence(sequence);
      const row = await prisma.reminder.create({
        data: {
          tenantId: input.tenantId,
          userId: user?.id,
          groupId: group?.id,
          message: input.message,
          remindAt: input.remindAt,
          status: ReminderStatus.SCHEDULED,
          waUserId: input.waUserId,
          waGroupId: input.waGroupId,
          sequence,
          publicId
        },
        select: { id: true, status: true, publicId: true, sequence: true }
      });
      return { id: row.id, publicId: buildReminderPublicId(row), status: row.status };
    },

    listForDay: async (input: { tenantId: string; waGroupId?: string; waUserId: string; dayStart: Date; dayEnd: Date }) => {
      const where: Prisma.ReminderWhereInput = {
        ...reminderScopeWhere(input),
        remindAt: { gte: input.dayStart, lte: input.dayEnd },
        status: ReminderStatus.SCHEDULED
      };
      const rows = await prisma.reminder.findMany({ where, orderBy: { remindAt: "asc" } });
      return rows.map((row) => ({
        id: row.id,
        publicId: buildReminderPublicId(row),
        status: row.status,
        remindAt: row.remindAt,
        message: row.message
      }));
    },

    updateReminder: async (input: { tenantId: string; reminderId: string; waGroupId?: string; waUserId?: string; message?: string; remindAt?: Date }) => {
      const row = await findReminderByRef(prisma, {
        tenantId: input.tenantId,
        reminderRef: input.reminderId,
        waGroupId: input.waGroupId,
        waUserId: input.waUserId
      });
      if (!row) return null;
      const data: Prisma.ReminderUpdateInput = {};
      if (input.message !== undefined) data.message = input.message;
      if (input.remindAt) data.remindAt = input.remindAt;
      const updated = await prisma.reminder.update({ where: { id: row.id }, data });
      return {
        id: updated.id,
        publicId: buildReminderPublicId(updated),
        status: updated.status,
        remindAt: updated.remindAt,
        message: updated.message
      };
    },

    deleteReminder: async (input: { tenantId: string; reminderId: string; waGroupId?: string; waUserId?: string }) => {
      const row = await findReminderByRef(prisma, {
        tenantId: input.tenantId,
        reminderRef: input.reminderId,
        waGroupId: input.waGroupId,
        waUserId: input.waUserId
      });
      if (!row) return null;
      const updated = await prisma.reminder.update({ where: { id: row.id }, data: { status: ReminderStatus.CANCELED } });
      return {
        id: updated.id,
        publicId: buildReminderPublicId(updated),
        status: updated.status,
        remindAt: updated.remindAt,
        message: updated.message
      };
    },

    countScheduled: async (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => {
      const where: Prisma.ReminderWhereInput = {
        ...reminderScopeWhere(input),
        status: ReminderStatus.SCHEDULED
      };
      return prisma.reminder.count({ where });
    }
  };
};
