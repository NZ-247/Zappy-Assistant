import { ReminderStatus, type PrismaClient } from "@prisma/client";

export type ReminderStatusValue = (typeof ReminderStatus)[keyof typeof ReminderStatus];

export interface AdminJobsRepositoryDeps {
  prisma: PrismaClient;
}

export interface ReminderView {
  id: string;
  tenantId?: string | null;
  waUserId?: string | null;
  waGroupId?: string | null;
  publicId?: string | null;
  sequence?: number | null;
  message: string;
  remindAt: Date;
  status: ReminderStatusValue;
  sentMessageId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const mapReminder = (row: {
  id: string;
  tenantId: string | null;
  waUserId: string | null;
  waGroupId: string | null;
  publicId: string | null;
  sequence: number | null;
  message: string;
  remindAt: Date;
  status: ReminderStatus;
  sentMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ReminderView => ({
  id: row.id,
  tenantId: row.tenantId,
  waUserId: row.waUserId,
  waGroupId: row.waGroupId,
  publicId: row.publicId,
  sequence: row.sequence,
  message: row.message,
  remindAt: row.remindAt,
  status: row.status,
  sentMessageId: row.sentMessageId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const reminderSelect = {
  id: true,
  tenantId: true,
  waUserId: true,
  waGroupId: true,
  publicId: true,
  sequence: true,
  message: true,
  remindAt: true,
  status: true,
  sentMessageId: true,
  createdAt: true,
  updatedAt: true
} as const;

export const createAdminJobsRepository = (deps: AdminJobsRepositoryDeps) => {
  const listReminders = async (input: {
    tenantId?: string;
    status?: ReminderStatus;
    limit?: number;
  } = {}): Promise<ReminderView[]> => {
    const rows = await deps.prisma.reminder.findMany({
      where: {
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        ...(input.status ? { status: input.status } : {})
      },
      orderBy: [{ updatedAt: "desc" }, { remindAt: "desc" }],
      take: input.limit ?? 100,
      select: reminderSelect
    });
    return rows.map(mapReminder);
  };

  const getReminder = async (input: {
    reminderId: string;
    tenantId?: string;
  }): Promise<ReminderView | null> => {
    const row = await deps.prisma.reminder.findFirst({
      where: {
        id: input.reminderId,
        ...(input.tenantId ? { tenantId: input.tenantId } : {})
      },
      select: reminderSelect
    });
    return row ? mapReminder(row) : null;
  };

  const markReminderForRetry = async (input: {
    reminderId: string;
    tenantId?: string;
  }): Promise<ReminderView | null> => {
    const current = await getReminder({
      reminderId: input.reminderId,
      tenantId: input.tenantId
    });
    if (!current) return null;

    const row = await deps.prisma.reminder.update({
      where: { id: current.id },
      data: {
        status: ReminderStatus.SCHEDULED,
        sentMessageId: null
      },
      select: reminderSelect
    });

    return mapReminder(row);
  };

  const setReminderStatus = async (input: {
    reminderId: string;
    status: ReminderStatus;
    tenantId?: string;
    sentMessageId?: string | null;
  }): Promise<ReminderView | null> => {
    const current = await getReminder({
      reminderId: input.reminderId,
      tenantId: input.tenantId
    });
    if (!current) return null;

    const row = await deps.prisma.reminder.update({
      where: { id: current.id },
      data: {
        status: input.status,
        ...(input.sentMessageId !== undefined ? { sentMessageId: input.sentMessageId } : {})
      },
      select: reminderSelect
    });

    return mapReminder(row);
  };

  const getReminderStatusCounts = async (input: { tenantId?: string } = {}) => {
    const grouped = await deps.prisma.reminder.groupBy({
      by: ["status"],
      _count: {
        _all: true
      },
      where: input.tenantId ? { tenantId: input.tenantId } : undefined
    });

    const counts: Record<ReminderStatusValue, number> = {
      SCHEDULED: 0,
      SENT: 0,
      FAILED: 0,
      CANCELED: 0
    };

    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }

    return counts;
  };

  const listRecentFailedReminders = async (input: {
    tenantId?: string;
    limit?: number;
  } = {}): Promise<ReminderView[]> => {
    const rows = await deps.prisma.reminder.findMany({
      where: {
        status: ReminderStatus.FAILED,
        ...(input.tenantId ? { tenantId: input.tenantId } : {})
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: input.limit ?? 10,
      select: reminderSelect
    });
    return rows.map(mapReminder);
  };

  return {
    listReminders,
    getReminder,
    markReminderForRetry,
    setReminderStatus,
    getReminderStatusCounts,
    listRecentFailedReminders
  };
};

export type AdminJobsRepository = ReturnType<typeof createAdminJobsRepository>;
