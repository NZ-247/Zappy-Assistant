import {
  AccessStatus,
  AccessSubjectType,
  AuditAction,
  LicenseTier,
  Prisma,
  type PrismaClient
} from "@prisma/client";

export type AccessStatusValue = (typeof AccessStatus)[keyof typeof AccessStatus];
export type LicenseTierValue = (typeof LicenseTier)[keyof typeof LicenseTier];

export interface AdminGovernanceRepositoryDeps {
  prisma: PrismaClient;
  defaultTenantName?: string;
  now?: () => Date;
  writeAudit?: (actor: string, action: AuditAction, entity: string, entityId: string, metadata?: unknown) => Promise<void>;
}

export interface UserAccessView {
  tenantId: string;
  waUserId: string;
  phoneNumber?: string | null;
  displayName?: string | null;
  status: AccessStatusValue;
  tier: LicenseTierValue;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupAccessView {
  tenantId: string;
  waGroupId: string;
  groupName?: string | null;
  status: AccessStatusValue;
  tier: LicenseTierValue;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_TENANT_NAME = "Default Tenant";

const DEFAULT_LICENSE_PLANS: Array<{
  tier: LicenseTier;
  displayName: string;
  description: string;
  capabilityDefaults: Prisma.InputJsonValue;
}> = [
  {
    tier: LicenseTier.FREE,
    displayName: "Free",
    description: "Safe default while access approval is pending.",
    capabilityDefaults: {
      governanceShadowOnly: true,
      supportLevel: "community"
    } satisfies Prisma.InputJsonObject
  },
  {
    tier: LicenseTier.BASIC,
    displayName: "Basic",
    description: "Baseline licensed usage for approved entities.",
    capabilityDefaults: {
      governanceShadowOnly: true,
      supportLevel: "standard"
    } satisfies Prisma.InputJsonObject
  },
  {
    tier: LicenseTier.PRO,
    displayName: "Pro",
    description: "Elevated capabilities and higher usage ceilings.",
    capabilityDefaults: {
      governanceShadowOnly: true,
      supportLevel: "priority"
    } satisfies Prisma.InputJsonObject
  },
  {
    tier: LicenseTier.ROOT,
    displayName: "Root",
    description: "Administrative tier reserved for platform operators.",
    capabilityDefaults: {
      governanceShadowOnly: true,
      supportLevel: "owner"
    } satisfies Prisma.InputJsonObject
  }
];

const asJsonValue = (value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
};

const mapUserAccessRow = (row: {
  tenantId: string;
  waUserId: string;
  phoneNumber: string | null;
  displayName: string | null;
  status: AccessStatus;
  tier: LicenseTier;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): UserAccessView => ({
  tenantId: row.tenantId,
  waUserId: row.waUserId,
  phoneNumber: row.phoneNumber,
  displayName: row.displayName,
  status: row.status,
  tier: row.tier,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const mapGroupAccessRow = (row: {
  tenantId: string;
  waGroupId: string;
  groupName: string | null;
  status: AccessStatus;
  tier: LicenseTier;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): GroupAccessView => ({
  tenantId: row.tenantId,
  waGroupId: row.waGroupId,
  groupName: row.groupName,
  status: row.status,
  tier: row.tier,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

export const createAdminGovernanceRepository = (deps: AdminGovernanceRepositoryDeps) => {
  const now = deps.now ?? (() => new Date());

  const resolveTenant = async (tenantId?: string | null): Promise<{ id: string; name: string }> => {
    if (tenantId) {
      const existing = await deps.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
      if (existing) return existing;
    }

    const defaultTenantName = deps.defaultTenantName ?? DEFAULT_TENANT_NAME;
    const existingByName = await deps.prisma.tenant.findFirst({ where: { name: defaultTenantName }, select: { id: true, name: true } });
    if (existingByName) return existingByName;

    return deps.prisma.tenant.create({ data: { name: defaultTenantName }, select: { id: true, name: true } });
  };

  const maybeWriteLegacyAudit = async (input: {
    actor: string;
    action: AuditAction;
    entity: string;
    entityId: string;
    metadata?: unknown;
  }): Promise<void> => {
    if (!deps.writeAudit) return;
    await deps.writeAudit(input.actor, input.action, input.entity, input.entityId, input.metadata);
  };

  const writeApprovalAudit = async (input: {
    subjectType: AccessSubjectType;
    subjectId: string;
    action: string;
    actor: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void> => {
    await deps.prisma.approvalAudit.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        action: input.action,
        actor: input.actor,
        before: asJsonValue(input.before),
        after: asJsonValue(input.after)
      }
    });
  };

  const resolveTenantIdForUser = async (input: { tenantId?: string | null; waUserId: string }): Promise<string> => {
    if (input.tenantId) return (await resolveTenant(input.tenantId)).id;
    const existingUser = await deps.prisma.user.findUnique({
      where: { waUserId: input.waUserId },
      select: { tenantId: true }
    });
    if (existingUser?.tenantId) return existingUser.tenantId;
    return (await resolveTenant()).id;
  };

  const resolveTenantIdForGroup = async (input: { tenantId?: string | null; waGroupId: string }): Promise<string> => {
    if (input.tenantId) return (await resolveTenant(input.tenantId)).id;
    const existingGroup = await deps.prisma.group.findUnique({
      where: { waGroupId: input.waGroupId },
      select: { tenantId: true }
    });
    if (existingGroup?.tenantId) return existingGroup.tenantId;
    return (await resolveTenant()).id;
  };

  const ensureDirectoryUser = async (input: {
    tenantId: string;
    waUserId: string;
    phoneNumber?: string | null;
    displayName?: string | null;
  }) => {
    const existing = await deps.prisma.user.findUnique({ where: { waUserId: input.waUserId } });
    if (!existing) {
      return deps.prisma.user.create({
        data: {
          tenantId: input.tenantId,
          waUserId: input.waUserId,
          phoneNumber: input.phoneNumber ?? null,
          displayName: input.displayName ?? input.waUserId,
          role: "member"
        }
      });
    }

    const updates: Prisma.UserUpdateInput = {};
    if (!existing.phoneNumber && input.phoneNumber) updates.phoneNumber = input.phoneNumber;
    if (!existing.displayName && input.displayName) updates.displayName = input.displayName;

    if (Object.keys(updates).length === 0) return existing;
    return deps.prisma.user.update({ where: { id: existing.id }, data: updates });
  };

  const ensureDirectoryGroup = async (input: { tenantId: string; waGroupId: string; groupName?: string | null }) => {
    const existing = await deps.prisma.group.findUnique({ where: { waGroupId: input.waGroupId } });
    if (!existing) {
      return deps.prisma.group.create({
        data: {
          tenantId: input.tenantId,
          waGroupId: input.waGroupId,
          name: input.groupName ?? input.waGroupId,
          allowed: false,
          chatMode: "ON",
          isOpen: true,
          welcomeEnabled: false,
          moderationConfig: {}
        }
      });
    }

    if (!input.groupName || input.groupName === existing.name) return existing;
    return deps.prisma.group.update({ where: { id: existing.id }, data: { name: input.groupName } });
  };

  const ensureUserAccess = async (input: {
    tenantId?: string | null;
    waUserId: string;
    phoneNumber?: string | null;
    displayName?: string | null;
  }) => {
    const tenantId = await resolveTenantIdForUser({ tenantId: input.tenantId, waUserId: input.waUserId });
    const user = await ensureDirectoryUser({
      tenantId,
      waUserId: input.waUserId,
      phoneNumber: input.phoneNumber,
      displayName: input.displayName
    });

    const row = await deps.prisma.userAccess.upsert({
      where: {
        tenantId_waUserId: {
          tenantId,
          waUserId: input.waUserId
        }
      },
      update: {
        phoneNumber: user.phoneNumber ?? input.phoneNumber ?? null,
        displayName: user.displayName ?? input.displayName ?? null
      },
      create: {
        tenantId,
        waUserId: input.waUserId,
        phoneNumber: user.phoneNumber ?? input.phoneNumber ?? null,
        displayName: user.displayName ?? input.displayName ?? null,
        status: AccessStatus.PENDING,
        tier: LicenseTier.FREE
      }
    });

    return mapUserAccessRow(row);
  };

  const ensureGroupAccess = async (input: { tenantId?: string | null; waGroupId: string; groupName?: string | null }) => {
    const tenantId = await resolveTenantIdForGroup({ tenantId: input.tenantId, waGroupId: input.waGroupId });
    const group = await ensureDirectoryGroup({ tenantId, waGroupId: input.waGroupId, groupName: input.groupName });

    const row = await deps.prisma.groupAccess.upsert({
      where: {
        tenantId_waGroupId: {
          tenantId,
          waGroupId: input.waGroupId
        }
      },
      update: {
        groupName: group.name
      },
      create: {
        tenantId,
        waGroupId: input.waGroupId,
        groupName: group.name,
        status: AccessStatus.PENDING,
        tier: LicenseTier.FREE
      }
    });

    return mapGroupAccessRow(row);
  };

  const ensureLicensePlans = async () => {
    for (const plan of DEFAULT_LICENSE_PLANS) {
      await deps.prisma.licensePlan.upsert({
        where: { tier: plan.tier },
        create: {
          tier: plan.tier,
          displayName: plan.displayName,
          description: plan.description,
          capabilityDefaults: plan.capabilityDefaults,
          active: true
        },
        update: {
          displayName: plan.displayName,
          description: plan.description,
          capabilityDefaults: plan.capabilityDefaults
        }
      });
    }
  };

  const updateUserAccessStatus = async (input: {
    tenantId?: string | null;
    waUserId: string;
    status: AccessStatus;
    actor: string;
  }) => {
    const current = await ensureUserAccess({ tenantId: input.tenantId, waUserId: input.waUserId });
    const timestamp = now();
    const next = await deps.prisma.userAccess.update({
      where: {
        tenantId_waUserId: {
          tenantId: current.tenantId,
          waUserId: current.waUserId
        }
      },
      data: {
        status: input.status,
        approvedBy: input.status === AccessStatus.APPROVED ? input.actor : null,
        approvedAt: input.status === AccessStatus.APPROVED ? timestamp : null
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.USER,
      subjectId: current.waUserId,
      action: "USER_ACCESS_STATUS_UPDATED",
      actor: input.actor,
      before: current,
      after: next
    });
    await maybeWriteLegacyAudit({
      actor: input.actor,
      action: AuditAction.UPDATE,
      entity: "UserAccess",
      entityId: current.waUserId,
      metadata: {
        status: input.status,
        tenantId: current.tenantId
      }
    });

    return mapUserAccessRow(next);
  };

  const updateGroupAccessStatus = async (input: {
    tenantId?: string | null;
    waGroupId: string;
    status: AccessStatus;
    actor: string;
  }) => {
    const current = await ensureGroupAccess({ tenantId: input.tenantId, waGroupId: input.waGroupId });
    const timestamp = now();
    const next = await deps.prisma.groupAccess.update({
      where: {
        tenantId_waGroupId: {
          tenantId: current.tenantId,
          waGroupId: current.waGroupId
        }
      },
      data: {
        status: input.status,
        approvedBy: input.status === AccessStatus.APPROVED ? input.actor : null,
        approvedAt: input.status === AccessStatus.APPROVED ? timestamp : null
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.GROUP,
      subjectId: current.waGroupId,
      action: "GROUP_ACCESS_STATUS_UPDATED",
      actor: input.actor,
      before: current,
      after: next
    });
    await maybeWriteLegacyAudit({
      actor: input.actor,
      action: AuditAction.UPDATE,
      entity: "GroupAccess",
      entityId: current.waGroupId,
      metadata: {
        status: input.status,
        tenantId: current.tenantId
      }
    });

    return mapGroupAccessRow(next);
  };

  const updateUserLicense = async (input: {
    tenantId?: string | null;
    waUserId: string;
    tier: LicenseTier;
    actor: string;
  }) => {
    await ensureLicensePlans();
    const current = await ensureUserAccess({ tenantId: input.tenantId, waUserId: input.waUserId });
    const next = await deps.prisma.userAccess.update({
      where: {
        tenantId_waUserId: {
          tenantId: current.tenantId,
          waUserId: current.waUserId
        }
      },
      data: {
        tier: input.tier
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.USER,
      subjectId: current.waUserId,
      action: "USER_LICENSE_UPDATED",
      actor: input.actor,
      before: current,
      after: next
    });
    await maybeWriteLegacyAudit({
      actor: input.actor,
      action: AuditAction.UPDATE,
      entity: "UserAccess",
      entityId: current.waUserId,
      metadata: {
        tier: input.tier,
        tenantId: current.tenantId
      }
    });

    return mapUserAccessRow(next);
  };

  const updateGroupLicense = async (input: {
    tenantId?: string | null;
    waGroupId: string;
    tier: LicenseTier;
    actor: string;
  }) => {
    await ensureLicensePlans();
    const current = await ensureGroupAccess({ tenantId: input.tenantId, waGroupId: input.waGroupId });
    const next = await deps.prisma.groupAccess.update({
      where: {
        tenantId_waGroupId: {
          tenantId: current.tenantId,
          waGroupId: current.waGroupId
        }
      },
      data: {
        tier: input.tier
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.GROUP,
      subjectId: current.waGroupId,
      action: "GROUP_LICENSE_UPDATED",
      actor: input.actor,
      before: current,
      after: next
    });
    await maybeWriteLegacyAudit({
      actor: input.actor,
      action: AuditAction.UPDATE,
      entity: "GroupAccess",
      entityId: current.waGroupId,
      metadata: {
        tier: input.tier,
        tenantId: current.tenantId
      }
    });

    return mapGroupAccessRow(next);
  };

  const materializeUserAccessFromDirectory = async (input: {
    tenantId?: string | null;
    limit?: number;
  }): Promise<void> => {
    const rows = await deps.prisma.user.findMany({
      where: input.tenantId ? { tenantId: input.tenantId } : undefined,
      select: {
        tenantId: true,
        waUserId: true,
        phoneNumber: true,
        displayName: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: input.limit ?? 200
    });

    await Promise.all(
      rows.map((row) =>
        ensureUserAccess({
          tenantId: row.tenantId,
          waUserId: row.waUserId,
          phoneNumber: row.phoneNumber,
          displayName: row.displayName
        })
      )
    );
  };

  const materializeGroupAccessFromDirectory = async (input: {
    tenantId?: string | null;
    limit?: number;
  }): Promise<void> => {
    const rows = await deps.prisma.group.findMany({
      where: input.tenantId ? { tenantId: input.tenantId } : undefined,
      select: {
        tenantId: true,
        waGroupId: true,
        name: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: input.limit ?? 200
    });

    await Promise.all(
      rows.map((row) =>
        ensureGroupAccess({
          tenantId: row.tenantId,
          waGroupId: row.waGroupId,
          groupName: row.name
        })
      )
    );
  };

  const listUsers = async (input: {
    tenantId?: string | null;
    limit?: number;
  } = {}): Promise<UserAccessView[]> => {
    await materializeUserAccessFromDirectory({ tenantId: input.tenantId, limit: input.limit ?? 200 });
    const rows = await deps.prisma.userAccess.findMany({
      where: input.tenantId ? { tenantId: input.tenantId } : undefined,
      orderBy: {
        updatedAt: "desc"
      },
      take: input.limit ?? 200
    });
    return rows.map(mapUserAccessRow);
  };

  const listGroups = async (input: {
    tenantId?: string | null;
    limit?: number;
  } = {}): Promise<GroupAccessView[]> => {
    await materializeGroupAccessFromDirectory({ tenantId: input.tenantId, limit: input.limit ?? 200 });
    const rows = await deps.prisma.groupAccess.findMany({
      where: input.tenantId ? { tenantId: input.tenantId } : undefined,
      orderBy: {
        updatedAt: "desc"
      },
      take: input.limit ?? 200
    });
    return rows.map(mapGroupAccessRow);
  };

  const getUser = async (input: { tenantId?: string | null; waUserId: string }): Promise<UserAccessView> =>
    ensureUserAccess({
      tenantId: input.tenantId,
      waUserId: input.waUserId
    });

  const getGroup = async (input: { tenantId?: string | null; waGroupId: string }): Promise<GroupAccessView> =>
    ensureGroupAccess({
      tenantId: input.tenantId,
      waGroupId: input.waGroupId
    });

  const listLicensePlans = async (input: { activeOnly?: boolean } = {}) => {
    await ensureLicensePlans();
    return deps.prisma.licensePlan.findMany({
      where: input.activeOnly ? { active: true } : undefined,
      orderBy: {
        tier: "asc"
      }
    });
  };

  const listUsageCounters = async (input: {
    subjectType: AccessSubjectType;
    subjectId: string;
    bucket?: string;
  }) => {
    return deps.prisma.usageCounter.findMany({
      where: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        ...(input.bucket ? { bucket: input.bucket } : {})
      },
      orderBy: [{ periodKey: "desc" }, { bucket: "asc" }]
    });
  };

  const getUserUsage = async (input: { tenantId?: string | null; waUserId: string }) => {
    const tenantId = (await ensureUserAccess({ tenantId: input.tenantId, waUserId: input.waUserId })).tenantId;

    const [counters, inboundCount, outboundCount, commandCount] = await Promise.all([
      listUsageCounters({ subjectType: AccessSubjectType.USER, subjectId: input.waUserId }),
      deps.prisma.message.count({ where: { tenantId, waUserId: input.waUserId, direction: "INBOUND" } }),
      deps.prisma.message.count({ where: { tenantId, waUserId: input.waUserId, direction: "OUTBOUND" } }),
      deps.prisma.commandLog.count({ where: { tenantId, waUserId: input.waUserId } })
    ]);

    return {
      subjectType: AccessSubjectType.USER,
      subjectId: input.waUserId,
      tenantId,
      counters,
      summary: {
        inboundMessages: inboundCount,
        outboundMessages: outboundCount,
        commandsExecuted: commandCount
      }
    };
  };

  const getGroupUsage = async (input: { tenantId?: string | null; waGroupId: string }) => {
    const tenantId = (await ensureGroupAccess({ tenantId: input.tenantId, waGroupId: input.waGroupId })).tenantId;

    const [counters, inboundCount, outboundCount, commandCount] = await Promise.all([
      listUsageCounters({ subjectType: AccessSubjectType.GROUP, subjectId: input.waGroupId }),
      deps.prisma.message.count({ where: { tenantId, waGroupId: input.waGroupId, direction: "INBOUND" } }),
      deps.prisma.message.count({ where: { tenantId, waGroupId: input.waGroupId, direction: "OUTBOUND" } }),
      deps.prisma.commandLog.count({ where: { tenantId, waGroupId: input.waGroupId } })
    ]);

    return {
      subjectType: AccessSubjectType.GROUP,
      subjectId: input.waGroupId,
      tenantId,
      counters,
      summary: {
        inboundMessages: inboundCount,
        outboundMessages: outboundCount,
        commandsExecuted: commandCount
      }
    };
  };

  const listApprovalAudit = async (input: {
    limit?: number;
    subjectType?: AccessSubjectType;
    subjectId?: string;
  } = {}) => {
    return deps.prisma.approvalAudit.findMany({
      where: {
        ...(input.subjectType ? { subjectType: input.subjectType } : {}),
        ...(input.subjectId ? { subjectId: input.subjectId } : {})
      },
      orderBy: {
        createdAt: "desc"
      },
      take: input.limit ?? 100
    });
  };

  return {
    ensureLicensePlans,
    getOrMaterializeUserAccess: ensureUserAccess,
    getOrMaterializeGroupAccess: ensureGroupAccess,
    listUsers,
    getUser,
    updateUserAccessStatus,
    listGroups,
    getGroup,
    updateGroupAccessStatus,
    listLicensePlans,
    updateUserLicense,
    updateGroupLicense,
    getUserUsage,
    getGroupUsage,
    listUsageCounters,
    listApprovalAudit
  };
};

export type AdminGovernanceRepository = ReturnType<typeof createAdminGovernanceRepository>;
