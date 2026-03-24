import { TimerStatus, type Prisma, type PrismaClient } from "@prisma/client";
import type { TimerCreateInput } from "@zappy/core";
import type { ScopedResolver } from "../shared/scoped-resolver.js";

export interface TimersRepositoryDeps {
  prisma: PrismaClient;
  resolveScopedUserAndGroup: ScopedResolver;
}

export const createTimersRepository = (deps: TimersRepositoryDeps) => {
  const { prisma, resolveScopedUserAndGroup } = deps;

  return {
    createTimer: async (input: TimerCreateInput) => {
      const { user, group } = await resolveScopedUserAndGroup({
        tenantId: input.tenantId,
        waUserId: input.waUserId,
        waGroupId: input.waGroupId
      });
      const row = await prisma.timer.create({
        data: {
          tenantId: input.tenantId,
          groupId: group?.id,
          userId: user?.id,
          waUserId: input.waUserId,
          waGroupId: input.waGroupId,
          fireAt: input.fireAt,
          durationMs: input.durationMs,
          label: input.label,
          status: TimerStatus.SCHEDULED
        }
      });
      return { id: row.id, status: row.status, fireAt: row.fireAt };
    },

    getTimerById: async (id: string) => prisma.timer.findUnique({ where: { id } }),

    countScheduled: async (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => {
      const where: Prisma.TimerWhereInput = {
        tenantId: input.tenantId,
        status: TimerStatus.SCHEDULED,
        waGroupId: input.waGroupId ?? undefined,
        waUserId: input.waGroupId ? undefined : input.waUserId
      };
      return prisma.timer.count({ where });
    }
  };
};
