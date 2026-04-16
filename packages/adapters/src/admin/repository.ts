import {
  AccessStatus,
  AccessSubjectType,
  AuditAction,
  CapabilityOverrideMode,
  LicenseTier,
  Prisma,
  type PrismaClient
} from "@prisma/client";
import {
  GOVERNANCE_BUNDLE_DEFINITIONS,
  GOVERNANCE_CAPABILITY_DEFINITIONS,
  GOVERNANCE_TIER_DEFAULT_BUNDLES,
  createDefaultCapabilityPolicySnapshot,
  listEffectiveCapabilities,
  normalizeGovernanceCapabilityKey
} from "@zappy/core";

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
  permissionRole?: string | null;
  authorityRole: "MEMBER" | "ADMIN" | "ROOT";
  isBotAdmin: boolean;
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

export interface CapabilityDefinitionView {
  key: string;
  displayName: string;
  description?: string | null;
  category?: string | null;
  bundles: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CapabilityBundleView {
  key: string;
  displayName: string;
  description?: string | null;
  active: boolean;
  capabilities: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceDefaultsView {
  defaults: {
    privateUser: {
      status: AccessStatusValue;
      tier: LicenseTierValue;
      source: "system_default";
    };
    group: {
      status: AccessStatusValue;
      tier: LicenseTierValue;
      source: "system_default";
    };
  };
  onboarding: {
    privateAssistantEnabled: boolean;
    serviceExplanationEnabled: boolean;
    basicQuoteHelpEnabled: boolean;
  };
  governance: {
    separationRule: "private_and_group_defaults_are_independent";
  };
}

export interface SubjectCapabilityPolicyView {
  tenantId: string;
  subjectType: "USER" | "GROUP";
  subjectId: string;
  tier: LicenseTierValue;
  status: AccessStatusValue;
  assignedBundles: {
    user: string[];
    group: string[];
  };
  overrides: {
    user: Record<string, "allow" | "deny">;
    group: Record<string, "allow" | "deny">;
  };
  effectiveCapabilities: Array<{
    key: string;
    allow: boolean;
    source: "tier_default" | "bundle" | "user_override_allow" | "group_override_allow" | "none";
    denySource: "tier_default" | "missing_bundle" | "explicit_override_deny" | "blocked_status" | "quota_denied" | "policy_flag" | "unknown" | null;
    tierDefaultAllowed: boolean;
    bundleAllowed: boolean;
    matchedBundles: string[];
    explicitAllowSource: "user_override_allow" | "group_override_allow" | null;
    explicitDenySources: Array<"user_override_deny" | "group_override_deny">;
  }>;
}

const DEFAULT_TENANT_NAME = "Default Tenant";

const GOVERNANCE_DEFAULT_MATERIALIZATION = {
  privateUser: {
    status: AccessStatus.APPROVED,
    tier: LicenseTier.FREE,
    approvedBy: "system:private-default"
  },
  group: {
    status: AccessStatus.PENDING,
    tier: LicenseTier.FREE
  }
} as const;

const DEFAULT_LICENSE_PLANS: Array<{
  tier: LicenseTier;
  displayName: string;
  description: string;
  capabilityDefaults: Prisma.InputJsonValue;
}> = [
  {
    tier: LicenseTier.FREE,
    displayName: "Free",
    description: "Onboarding-friendly default entitlement for private users.",
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

const DEFAULT_CAPABILITY_DEFINITIONS = GOVERNANCE_CAPABILITY_DEFINITIONS.map((item) => ({
  key: normalizeGovernanceCapabilityKey(item.key),
  displayName: item.displayName,
  description: item.description ?? null,
  category: item.category ?? null,
  active: true
}));

const DEFAULT_CAPABILITY_BUNDLES = GOVERNANCE_BUNDLE_DEFINITIONS.map((bundle) => ({
  key: bundle.key,
  displayName: bundle.displayName,
  description: bundle.description ?? null,
  active: bundle.active,
  capabilities: bundle.capabilities.map((capability) => normalizeGovernanceCapabilityKey(capability))
}));

const normalizeBundleKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

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
  permissionRole?: string | null;
  isBotAdmin?: boolean;
  status: AccessStatus;
  tier: LicenseTier;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): UserAccessView => {
  const normalizedRole = (row.permissionRole ?? "").trim().toUpperCase();
  const authorityRole: UserAccessView["authorityRole"] =
    normalizedRole === "ROOT" || normalizedRole === "DONO" || normalizedRole === "OWNER"
      ? "ROOT"
      : normalizedRole === "ADMIN" || normalizedRole === "GROUP_ADMIN" || row.isBotAdmin
        ? "ADMIN"
        : "MEMBER";

  return {
    tenantId: row.tenantId,
    waUserId: row.waUserId,
    phoneNumber: row.phoneNumber,
    displayName: row.displayName,
    permissionRole: row.permissionRole ?? null,
    authorityRole,
    isBotAdmin: Boolean(row.isBotAdmin),
    status: row.status,
    tier: row.tier,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

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

const mapCapabilityDefinitionRow = (row: {
  key: string;
  displayName: string;
  description: string | null;
  category: string | null;
  bundleLinks?: Array<{
    bundle: {
      key: string;
    };
  }>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CapabilityDefinitionView => ({
  key: row.key,
  displayName: row.displayName,
  description: row.description,
  category: row.category,
  bundles: (row.bundleLinks ?? []).map((item) => item.bundle.key).sort((a, b) => a.localeCompare(b)),
  active: row.active,
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

  const resolveUserAuthorityMetadata = async (input: {
    tenantId: string;
    waUserId: string;
    knownPermissionRole?: string | null;
    knownLegacyRole?: string | null;
  }): Promise<{
    permissionRole: string | null;
    isBotAdmin: boolean;
  }> => {
    const [user, botAdmin] = await Promise.all([
      deps.prisma.user.findUnique({
        where: { waUserId: input.waUserId },
        select: {
          tenantId: true,
          permissionRole: true,
          role: true
        }
      }),
      deps.prisma.botAdmin.findUnique({
        where: {
          tenantId_waUserId: {
            tenantId: input.tenantId,
            waUserId: input.waUserId
          }
        },
        select: { id: true }
      })
    ]);

    const permissionRoleFromUser =
      user && user.tenantId === input.tenantId ? user.permissionRole ?? user.role ?? null : null;

    return {
      permissionRole: permissionRoleFromUser ?? input.knownPermissionRole ?? input.knownLegacyRole ?? null,
      isBotAdmin: Boolean(botAdmin)
    };
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
        status: GOVERNANCE_DEFAULT_MATERIALIZATION.privateUser.status,
        tier: GOVERNANCE_DEFAULT_MATERIALIZATION.privateUser.tier,
        approvedBy: GOVERNANCE_DEFAULT_MATERIALIZATION.privateUser.approvedBy,
        approvedAt: now()
      }
    });

    const authority = await resolveUserAuthorityMetadata({
      tenantId,
      waUserId: input.waUserId,
      knownPermissionRole: user.permissionRole,
      knownLegacyRole: user.role
    });

    return mapUserAccessRow({
      ...row,
      permissionRole: authority.permissionRole,
      isBotAdmin: authority.isBotAdmin
    });
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
        status: GOVERNANCE_DEFAULT_MATERIALIZATION.group.status,
        tier: GOVERNANCE_DEFAULT_MATERIALIZATION.group.tier
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

  const ensureCapabilityPolicyCatalog = async () => {
    for (const definition of DEFAULT_CAPABILITY_DEFINITIONS) {
      await deps.prisma.capabilityDefinition.upsert({
        where: { key: definition.key },
        create: {
          key: definition.key,
          displayName: definition.displayName,
          description: definition.description,
          category: definition.category,
          active: definition.active
        },
        update: {
          displayName: definition.displayName,
          description: definition.description,
          category: definition.category,
          active: definition.active
        }
      });
    }

    for (const bundle of DEFAULT_CAPABILITY_BUNDLES) {
      await deps.prisma.capabilityBundle.upsert({
        where: { key: bundle.key },
        create: {
          key: bundle.key,
          displayName: bundle.displayName,
          description: bundle.description,
          active: bundle.active
        },
        update: {
          displayName: bundle.displayName,
          description: bundle.description,
          active: bundle.active
        }
      });
    }

    const capabilityRows = await deps.prisma.capabilityDefinition.findMany({
      select: { id: true, key: true }
    });
    const capabilityByKey = new Map(capabilityRows.map((row) => [row.key, row.id]));
    const bundleRows = await deps.prisma.capabilityBundle.findMany({
      select: { id: true, key: true }
    });
    const bundleByKey = new Map(bundleRows.map((row) => [row.key, row.id]));

    for (const bundle of DEFAULT_CAPABILITY_BUNDLES) {
      const bundleId = bundleByKey.get(bundle.key);
      if (!bundleId) continue;
      for (const capabilityKey of bundle.capabilities) {
        const capabilityId = capabilityByKey.get(capabilityKey);
        if (!capabilityId) continue;
        await deps.prisma.capabilityBundleCapability.upsert({
          where: {
            bundleId_capabilityId: {
              bundleId,
              capabilityId
            }
          },
          create: {
            bundleId,
            capabilityId
          },
          update: {}
        });
      }
    }

    for (const [tier, bundles] of Object.entries(GOVERNANCE_TIER_DEFAULT_BUNDLES) as Array<[LicenseTier, string[]]>) {
      for (const bundleKey of bundles) {
        const bundleId = bundleByKey.get(bundleKey);
        if (!bundleId) continue;
        await deps.prisma.tierBundleDefault.upsert({
          where: {
            tier_bundleId: {
              tier,
              bundleId
            }
          },
          create: {
            tier,
            bundleId
          },
          update: {}
        });
      }
    }
  };

  const listCapabilityDefinitions = async (): Promise<CapabilityDefinitionView[]> => {
    await ensureCapabilityPolicyCatalog();
    const rows = await deps.prisma.capabilityDefinition.findMany({
      include: {
        bundleLinks: {
          include: {
            bundle: {
              select: { key: true }
            }
          }
        }
      },
      orderBy: {
        key: "asc"
      }
    });
    return rows.map(mapCapabilityDefinitionRow);
  };

  const mapCapabilityBundleRow = (row: {
    key: string;
    displayName: string;
    description: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    capabilityLinks: Array<{
      capability: {
        key: string;
      };
    }>;
  }): CapabilityBundleView => ({
    key: row.key,
    displayName: row.displayName,
    description: row.description,
    active: row.active,
    capabilities: row.capabilityLinks
      .map((link) => link.capability.key)
      .sort((a, b) => a.localeCompare(b)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });

  const listCapabilityBundles = async (): Promise<CapabilityBundleView[]> => {
    await ensureCapabilityPolicyCatalog();
    const rows = await deps.prisma.capabilityBundle.findMany({
      include: {
        capabilityLinks: {
          include: {
            capability: true
          }
        }
      },
      orderBy: {
        key: "asc"
      }
    });

    return rows.map(mapCapabilityBundleRow);
  };

  const resolveCapabilityPolicySnapshot = async (input: {
    tenantId: string;
    waUserId: string;
    waGroupId?: string;
    scope: "private" | "group";
  }) => {
    await ensureCapabilityPolicyCatalog();

    const [definitions, bundles, tierDefaults, userAssignments, groupAssignments, userOverrides, groupOverrides] = await Promise.all([
      deps.prisma.capabilityDefinition.findMany({
        orderBy: { key: "asc" }
      }),
      deps.prisma.capabilityBundle.findMany({
        include: {
          capabilityLinks: {
            include: {
              capability: true
            }
          }
        },
        orderBy: { key: "asc" }
      }),
      deps.prisma.tierBundleDefault.findMany({
        include: {
          bundle: {
            select: { key: true }
          }
        }
      }),
      deps.prisma.userBundleAssignment.findMany({
        where: {
          tenantId: input.tenantId,
          waUserId: input.waUserId
        },
        include: {
          bundle: {
            select: { key: true }
          }
        }
      }),
      input.waGroupId
        ? deps.prisma.groupBundleAssignment.findMany({
            where: {
              tenantId: input.tenantId,
              waGroupId: input.waGroupId
            },
            include: {
              bundle: {
                select: { key: true }
              }
            }
          })
        : Promise.resolve([]),
      deps.prisma.userCapabilityOverride.findMany({
        where: {
          tenantId: input.tenantId,
          waUserId: input.waUserId
        }
      }),
      input.waGroupId
        ? deps.prisma.groupCapabilityOverride.findMany({
            where: {
              tenantId: input.tenantId,
              waGroupId: input.waGroupId
            }
          })
        : Promise.resolve([])
    ]);

    const fallback = createDefaultCapabilityPolicySnapshot();

    return {
      definitions: definitions.length
        ? definitions.map((item) => ({
            key: item.key,
            displayName: item.displayName,
            description: item.description ?? undefined,
            category: item.category ?? undefined,
            active: item.active
          }))
        : fallback.definitions,
      bundles: bundles.length
        ? bundles.map((bundle) => ({
            key: bundle.key,
            displayName: bundle.displayName,
            description: bundle.description ?? undefined,
            active: bundle.active,
            capabilities: bundle.capabilityLinks.map((link) => link.capability.key).sort((a, b) => a.localeCompare(b))
          }))
        : fallback.bundles,
      tierDefaultBundles: {
        FREE: tierDefaults.filter((item) => item.tier === LicenseTier.FREE).map((item) => item.bundle.key),
        BASIC: tierDefaults.filter((item) => item.tier === LicenseTier.BASIC).map((item) => item.bundle.key),
        PRO: tierDefaults.filter((item) => item.tier === LicenseTier.PRO).map((item) => item.bundle.key),
        ROOT: tierDefaults.filter((item) => item.tier === LicenseTier.ROOT).map((item) => item.bundle.key)
      },
      assignments: {
        user: userAssignments.map((item) => item.bundle.key),
        group: groupAssignments.map((item) => item.bundle.key)
      },
      overrides: {
        user: userOverrides.reduce<Record<string, "allow" | "deny">>((acc, row) => {
          acc[row.capabilityKey] = row.mode === CapabilityOverrideMode.ALLOW ? "allow" : "deny";
          return acc;
        }, {}),
        group: groupOverrides.reduce<Record<string, "allow" | "deny">>((acc, row) => {
          acc[row.capabilityKey] = row.mode === CapabilityOverrideMode.ALLOW ? "allow" : "deny";
          return acc;
        }, {})
      }
    };
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

    const authority = await resolveUserAuthorityMetadata({
      tenantId: current.tenantId,
      waUserId: current.waUserId,
      knownPermissionRole: current.permissionRole
    });

    return mapUserAccessRow({
      ...next,
      permissionRole: authority.permissionRole,
      isBotAdmin: authority.isBotAdmin
    });
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

    const authority = await resolveUserAuthorityMetadata({
      tenantId: current.tenantId,
      waUserId: current.waUserId,
      knownPermissionRole: current.permissionRole
    });

    return mapUserAccessRow({
      ...next,
      permissionRole: authority.permissionRole,
      isBotAdmin: authority.isBotAdmin
    });
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

  const toBundleView = async (bundleKey: string): Promise<CapabilityBundleView> => {
    const normalizedBundleKey = normalizeBundleKey(bundleKey);
    const row = await deps.prisma.capabilityBundle.findUnique({
      where: { key: normalizedBundleKey },
      include: {
        capabilityLinks: {
          include: {
            capability: {
              select: { key: true }
            }
          }
        }
      }
    });
    if (!row) throw new Error(`bundle_not_found:${bundleKey}`);
    return mapCapabilityBundleRow(row);
  };

  const resolveBundleKey = (bundleKey: string): string => {
    const normalized = normalizeBundleKey(bundleKey);
    if (!normalized) throw new Error(`invalid_bundle_key:${bundleKey}`);
    return normalized;
  };

  const resolveBundle = async (bundleKey: string) => {
    await ensureCapabilityPolicyCatalog();
    const normalized = resolveBundleKey(bundleKey);
    const bundle = await deps.prisma.capabilityBundle.findUnique({
      where: { key: normalized },
      select: {
        id: true,
        key: true,
        displayName: true,
        description: true,
        active: true
      }
    });
    if (!bundle) throw new Error(`bundle_not_found:${bundleKey}`);
    return bundle;
  };

  const resolveCapabilityDefinitionRow = async (capabilityKey: string) => {
    await ensureCapabilityPolicyCatalog();
    const normalized = normalizeGovernanceCapabilityKey(capabilityKey);
    const definition = await deps.prisma.capabilityDefinition.findUnique({
      where: { key: normalized },
      select: {
        id: true,
        key: true
      }
    });
    if (!definition) throw new Error(`capability_not_found:${capabilityKey}`);
    return definition;
  };

  const resolveCapabilityDefinitions = async (capabilityKeys: string[]): Promise<Array<{ id: string; key: string }>> => {
    await ensureCapabilityPolicyCatalog();
    const normalizedKeys = [...new Set(capabilityKeys.map((key) => normalizeGovernanceCapabilityKey(key)).filter(Boolean))];
    if (!normalizedKeys.length) return [];

    const rows = await deps.prisma.capabilityDefinition.findMany({
      where: {
        key: {
          in: normalizedKeys
        }
      },
      select: {
        id: true,
        key: true
      }
    });

    const found = new Set(rows.map((item) => item.key));
    const missing = normalizedKeys.find((key) => !found.has(key));
    if (missing) throw new Error(`capability_not_found:${missing}`);

    return rows.sort((a, b) => a.key.localeCompare(b.key));
  };

  const replaceBundleCapabilities = async (input: { bundleId: string; capabilityKeys: string[] }) => {
    const definitions = await resolveCapabilityDefinitions(input.capabilityKeys);
    await deps.prisma.capabilityBundleCapability.deleteMany({
      where: {
        bundleId: input.bundleId
      }
    });

    if (!definitions.length) return;
    await deps.prisma.capabilityBundleCapability.createMany({
      data: definitions.map((definition) => ({
        bundleId: input.bundleId,
        capabilityId: definition.id
      })),
      skipDuplicates: true
    });
  };

  const createCapabilityBundle = async (input: {
    key: string;
    displayName: string;
    description?: string | null;
    active?: boolean;
    capabilityKeys?: string[];
    actor: string;
  }): Promise<CapabilityBundleView> => {
    await ensureCapabilityPolicyCatalog();
    const key = resolveBundleKey(input.key);
    const existing = await deps.prisma.capabilityBundle.findUnique({
      where: { key },
      select: { id: true }
    });
    if (existing) throw new Error(`bundle_exists:${key}`);

    const created = await deps.prisma.capabilityBundle.create({
      data: {
        key,
        displayName: input.displayName,
        description: input.description ?? null,
        active: input.active ?? true
      },
      select: {
        id: true,
        key: true
      }
    });

    if (input.capabilityKeys) {
      await replaceBundleCapabilities({
        bundleId: created.id,
        capabilityKeys: input.capabilityKeys
      });
    }

    await maybeWriteLegacyAudit({
      actor: input.actor,
      action: AuditAction.CREATE,
      entity: "CapabilityBundle",
      entityId: created.key,
      metadata: {
        key: created.key,
        capabilities: input.capabilityKeys ?? []
      }
    });

    return toBundleView(created.key);
  };

  const updateCapabilityBundle = async (input: {
    bundleKey: string;
    displayName?: string;
    description?: string | null;
    active?: boolean;
    capabilityKeys?: string[];
    actor: string;
  }): Promise<CapabilityBundleView> => {
    const bundle = await resolveBundle(input.bundleKey);
    const data: Prisma.CapabilityBundleUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.description !== undefined) data.description = input.description;
    if (input.active !== undefined) data.active = input.active;

    if (Object.keys(data).length) {
      await deps.prisma.capabilityBundle.update({
        where: { id: bundle.id },
        data
      });
    }

    if (input.capabilityKeys) {
      await replaceBundleCapabilities({
        bundleId: bundle.id,
        capabilityKeys: input.capabilityKeys
      });
    }

    await maybeWriteLegacyAudit({
      actor: input.actor,
      action: AuditAction.UPDATE,
      entity: "CapabilityBundle",
      entityId: bundle.key,
      metadata: {
        key: bundle.key,
        displayName: input.displayName,
        description: input.description,
        active: input.active,
        capabilities: input.capabilityKeys
      }
    });

    return toBundleView(bundle.key);
  };

  const assignCapabilityToBundle = async (input: {
    bundleKey: string;
    capabilityKey: string;
    actor: string;
  }) => {
    const bundle = await resolveBundle(input.bundleKey);
    const capability = await resolveCapabilityDefinitionRow(input.capabilityKey);

    const row = await deps.prisma.capabilityBundleCapability.upsert({
      where: {
        bundleId_capabilityId: {
          bundleId: bundle.id,
          capabilityId: capability.id
        }
      },
      create: {
        bundleId: bundle.id,
        capabilityId: capability.id
      },
      update: {}
    });

    await maybeWriteLegacyAudit({
      actor: input.actor,
      action: AuditAction.UPDATE,
      entity: "CapabilityBundle",
      entityId: bundle.key,
      metadata: {
        action: "ASSIGN_CAPABILITY",
        capabilityKey: capability.key
      }
    });

    return {
      bundleKey: bundle.key,
      capabilityKey: capability.key,
      linkedAt: row.createdAt
    };
  };

  const removeCapabilityFromBundle = async (input: {
    bundleKey: string;
    capabilityKey: string;
    actor: string;
  }) => {
    const bundle = await resolveBundle(input.bundleKey);
    const capability = await resolveCapabilityDefinitionRow(input.capabilityKey);

    await deps.prisma.capabilityBundleCapability.deleteMany({
      where: {
        bundleId: bundle.id,
        capabilityId: capability.id
      }
    });

    await maybeWriteLegacyAudit({
      actor: input.actor,
      action: AuditAction.UPDATE,
      entity: "CapabilityBundle",
      entityId: bundle.key,
      metadata: {
        action: "REMOVE_CAPABILITY",
        capabilityKey: capability.key
      }
    });

    return {
      bundleKey: bundle.key,
      capabilityKey: capability.key
    };
  };

  const resolveCapabilityDefinition = async (capabilityKey: string) => {
    const definition = await resolveCapabilityDefinitionRow(capabilityKey);
    return definition.key;
  };

  const assignUserBundle = async (input: {
    tenantId?: string | null;
    waUserId: string;
    bundleKey: string;
    actor: string;
  }) => {
    const current = await ensureUserAccess({ tenantId: input.tenantId, waUserId: input.waUserId });
    const bundle = await resolveBundle(input.bundleKey);

    const row = await deps.prisma.userBundleAssignment.upsert({
      where: {
        tenantId_waUserId_bundleId: {
          tenantId: current.tenantId,
          waUserId: current.waUserId,
          bundleId: bundle.id
        }
      },
      create: {
        tenantId: current.tenantId,
        waUserId: current.waUserId,
        bundleId: bundle.id,
        assignedBy: input.actor
      },
      update: {
        assignedBy: input.actor
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.USER,
      subjectId: current.waUserId,
      action: "USER_BUNDLE_ASSIGNED",
      actor: input.actor,
      before: null,
      after: {
        bundleKey: bundle.key,
        assignedBy: row.assignedBy
      }
    });

    return {
      tenantId: current.tenantId,
      waUserId: current.waUserId,
      bundleKey: bundle.key,
      assignedBy: row.assignedBy,
      updatedAt: row.updatedAt
    };
  };

  const removeUserBundle = async (input: {
    tenantId?: string | null;
    waUserId: string;
    bundleKey: string;
    actor: string;
  }) => {
    const current = await ensureUserAccess({ tenantId: input.tenantId, waUserId: input.waUserId });
    const bundle = await resolveBundle(input.bundleKey);

    await deps.prisma.userBundleAssignment.deleteMany({
      where: {
        tenantId: current.tenantId,
        waUserId: current.waUserId,
        bundleId: bundle.id
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.USER,
      subjectId: current.waUserId,
      action: "USER_BUNDLE_REMOVED",
      actor: input.actor,
      before: {
        bundleKey: bundle.key
      },
      after: null
    });

    return {
      tenantId: current.tenantId,
      waUserId: current.waUserId,
      bundleKey: bundle.key
    };
  };

  const assignGroupBundle = async (input: {
    tenantId?: string | null;
    waGroupId: string;
    bundleKey: string;
    actor: string;
  }) => {
    const current = await ensureGroupAccess({ tenantId: input.tenantId, waGroupId: input.waGroupId });
    const bundle = await resolveBundle(input.bundleKey);

    const row = await deps.prisma.groupBundleAssignment.upsert({
      where: {
        tenantId_waGroupId_bundleId: {
          tenantId: current.tenantId,
          waGroupId: current.waGroupId,
          bundleId: bundle.id
        }
      },
      create: {
        tenantId: current.tenantId,
        waGroupId: current.waGroupId,
        bundleId: bundle.id,
        assignedBy: input.actor
      },
      update: {
        assignedBy: input.actor
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.GROUP,
      subjectId: current.waGroupId,
      action: "GROUP_BUNDLE_ASSIGNED",
      actor: input.actor,
      before: null,
      after: {
        bundleKey: bundle.key,
        assignedBy: row.assignedBy
      }
    });

    return {
      tenantId: current.tenantId,
      waGroupId: current.waGroupId,
      bundleKey: bundle.key,
      assignedBy: row.assignedBy,
      updatedAt: row.updatedAt
    };
  };

  const removeGroupBundle = async (input: {
    tenantId?: string | null;
    waGroupId: string;
    bundleKey: string;
    actor: string;
  }) => {
    const current = await ensureGroupAccess({ tenantId: input.tenantId, waGroupId: input.waGroupId });
    const bundle = await resolveBundle(input.bundleKey);

    await deps.prisma.groupBundleAssignment.deleteMany({
      where: {
        tenantId: current.tenantId,
        waGroupId: current.waGroupId,
        bundleId: bundle.id
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.GROUP,
      subjectId: current.waGroupId,
      action: "GROUP_BUNDLE_REMOVED",
      actor: input.actor,
      before: {
        bundleKey: bundle.key
      },
      after: null
    });

    return {
      tenantId: current.tenantId,
      waGroupId: current.waGroupId,
      bundleKey: bundle.key
    };
  };

  const setUserCapabilityOverride = async (input: {
    tenantId?: string | null;
    waUserId: string;
    capabilityKey: string;
    mode: "allow" | "deny";
    actor: string;
  }) => {
    const current = await ensureUserAccess({ tenantId: input.tenantId, waUserId: input.waUserId });
    const capabilityKey = await resolveCapabilityDefinition(input.capabilityKey);
    const mode = input.mode === "allow" ? CapabilityOverrideMode.ALLOW : CapabilityOverrideMode.DENY;

    const row = await deps.prisma.userCapabilityOverride.upsert({
      where: {
        tenantId_waUserId_capabilityKey: {
          tenantId: current.tenantId,
          waUserId: current.waUserId,
          capabilityKey
        }
      },
      create: {
        tenantId: current.tenantId,
        waUserId: current.waUserId,
        capabilityKey,
        mode,
        updatedBy: input.actor
      },
      update: {
        mode,
        updatedBy: input.actor
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.USER,
      subjectId: current.waUserId,
      action: "USER_CAPABILITY_OVERRIDE_SET",
      actor: input.actor,
      before: null,
      after: {
        capabilityKey,
        mode: row.mode
      }
    });

    return {
      tenantId: current.tenantId,
      waUserId: current.waUserId,
      capabilityKey,
      mode: row.mode === CapabilityOverrideMode.ALLOW ? "allow" : "deny",
      updatedAt: row.updatedAt
    };
  };

  const clearUserCapabilityOverride = async (input: {
    tenantId?: string | null;
    waUserId: string;
    capabilityKey: string;
    actor: string;
  }) => {
    const current = await ensureUserAccess({ tenantId: input.tenantId, waUserId: input.waUserId });
    const capabilityKey = await resolveCapabilityDefinition(input.capabilityKey);

    await deps.prisma.userCapabilityOverride.deleteMany({
      where: {
        tenantId: current.tenantId,
        waUserId: current.waUserId,
        capabilityKey
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.USER,
      subjectId: current.waUserId,
      action: "USER_CAPABILITY_OVERRIDE_CLEARED",
      actor: input.actor,
      before: {
        capabilityKey
      },
      after: null
    });

    return {
      tenantId: current.tenantId,
      waUserId: current.waUserId,
      capabilityKey
    };
  };

  const setGroupCapabilityOverride = async (input: {
    tenantId?: string | null;
    waGroupId: string;
    capabilityKey: string;
    mode: "allow" | "deny";
    actor: string;
  }) => {
    const current = await ensureGroupAccess({ tenantId: input.tenantId, waGroupId: input.waGroupId });
    const capabilityKey = await resolveCapabilityDefinition(input.capabilityKey);
    const mode = input.mode === "allow" ? CapabilityOverrideMode.ALLOW : CapabilityOverrideMode.DENY;

    const row = await deps.prisma.groupCapabilityOverride.upsert({
      where: {
        tenantId_waGroupId_capabilityKey: {
          tenantId: current.tenantId,
          waGroupId: current.waGroupId,
          capabilityKey
        }
      },
      create: {
        tenantId: current.tenantId,
        waGroupId: current.waGroupId,
        capabilityKey,
        mode,
        updatedBy: input.actor
      },
      update: {
        mode,
        updatedBy: input.actor
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.GROUP,
      subjectId: current.waGroupId,
      action: "GROUP_CAPABILITY_OVERRIDE_SET",
      actor: input.actor,
      before: null,
      after: {
        capabilityKey,
        mode: row.mode
      }
    });

    return {
      tenantId: current.tenantId,
      waGroupId: current.waGroupId,
      capabilityKey,
      mode: row.mode === CapabilityOverrideMode.ALLOW ? "allow" : "deny",
      updatedAt: row.updatedAt
    };
  };

  const clearGroupCapabilityOverride = async (input: {
    tenantId?: string | null;
    waGroupId: string;
    capabilityKey: string;
    actor: string;
  }) => {
    const current = await ensureGroupAccess({ tenantId: input.tenantId, waGroupId: input.waGroupId });
    const capabilityKey = await resolveCapabilityDefinition(input.capabilityKey);

    await deps.prisma.groupCapabilityOverride.deleteMany({
      where: {
        tenantId: current.tenantId,
        waGroupId: current.waGroupId,
        capabilityKey
      }
    });

    await writeApprovalAudit({
      subjectType: AccessSubjectType.GROUP,
      subjectId: current.waGroupId,
      action: "GROUP_CAPABILITY_OVERRIDE_CLEARED",
      actor: input.actor,
      before: {
        capabilityKey
      },
      after: null
    });

    return {
      tenantId: current.tenantId,
      waGroupId: current.waGroupId,
      capabilityKey
    };
  };

  const getUserEffectiveCapabilityPolicy = async (input: {
    tenantId?: string | null;
    waUserId: string;
  }): Promise<SubjectCapabilityPolicyView> => {
    const user = await ensureUserAccess({ tenantId: input.tenantId, waUserId: input.waUserId });
    const capabilityPolicy = await resolveCapabilityPolicySnapshot({
      tenantId: user.tenantId,
      waUserId: user.waUserId,
      scope: "private"
    });

    const effectiveCapabilities = listEffectiveCapabilities({
      policy: capabilityPolicy,
      tier: user.tier,
      scope: "private"
    });

    return {
      tenantId: user.tenantId,
      subjectType: "USER",
      subjectId: user.waUserId,
      tier: user.tier,
      status: user.status,
      assignedBundles: capabilityPolicy.assignments,
      overrides: capabilityPolicy.overrides,
      effectiveCapabilities
    };
  };

  const getGroupEffectiveCapabilityPolicy = async (input: {
    tenantId?: string | null;
    waGroupId: string;
    waUserId?: string | null;
  }): Promise<SubjectCapabilityPolicyView> => {
    const group = await ensureGroupAccess({ tenantId: input.tenantId, waGroupId: input.waGroupId });
    const waUserId = input.waUserId?.trim() || "unknown@s.whatsapp.net";
    const capabilityPolicy = await resolveCapabilityPolicySnapshot({
      tenantId: group.tenantId,
      waUserId,
      waGroupId: group.waGroupId,
      scope: "group"
    });

    const effectiveCapabilities = listEffectiveCapabilities({
      policy: capabilityPolicy,
      tier: group.tier,
      scope: "group"
    });

    return {
      tenantId: group.tenantId,
      subjectType: "GROUP",
      subjectId: group.waGroupId,
      tier: group.tier,
      status: group.status,
      assignedBundles: capabilityPolicy.assignments,
      overrides: capabilityPolicy.overrides,
      effectiveCapabilities
    };
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
    return Promise.all(
      rows.map(async (row) => {
        const authority = await resolveUserAuthorityMetadata({
          tenantId: row.tenantId,
          waUserId: row.waUserId
        });
        return mapUserAccessRow({
          ...row,
          permissionRole: authority.permissionRole,
          isBotAdmin: authority.isBotAdmin
        });
      })
    );
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

  const getGovernanceDefaults = async (): Promise<GovernanceDefaultsView> => ({
    defaults: {
      privateUser: {
        status: GOVERNANCE_DEFAULT_MATERIALIZATION.privateUser.status,
        tier: GOVERNANCE_DEFAULT_MATERIALIZATION.privateUser.tier,
        source: "system_default"
      },
      group: {
        status: GOVERNANCE_DEFAULT_MATERIALIZATION.group.status,
        tier: GOVERNANCE_DEFAULT_MATERIALIZATION.group.tier,
        source: "system_default"
      }
    },
    onboarding: {
      privateAssistantEnabled: true,
      serviceExplanationEnabled: true,
      basicQuoteHelpEnabled: true
    },
    governance: {
      separationRule: "private_and_group_defaults_are_independent"
    }
  });

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
    ensureCapabilityPolicyCatalog,
    resolveCapabilityPolicySnapshot,
    getOrMaterializeUserAccess: ensureUserAccess,
    getOrMaterializeGroupAccess: ensureGroupAccess,
    listUsers,
    getUser,
    updateUserAccessStatus,
    listGroups,
    getGroup,
    updateGroupAccessStatus,
    listLicensePlans,
    getGovernanceDefaults,
    updateUserLicense,
    updateGroupLicense,
    listCapabilityDefinitions,
    listCapabilityBundles,
    createCapabilityBundle,
    updateCapabilityBundle,
    assignCapabilityToBundle,
    removeCapabilityFromBundle,
    getUserEffectiveCapabilityPolicy,
    getGroupEffectiveCapabilityPolicy,
    assignUserBundle,
    removeUserBundle,
    assignGroupBundle,
    removeGroupBundle,
    setUserCapabilityOverride,
    clearUserCapabilityOverride,
    setGroupCapabilityOverride,
    clearGroupCapabilityOverride,
    getUserUsage,
    getGroupUsage,
    listUsageCounters,
    listApprovalAudit
  };
};

export type AdminGovernanceRepository = ReturnType<typeof createAdminGovernanceRepository>;
