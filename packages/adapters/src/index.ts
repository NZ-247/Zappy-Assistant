import {
  AuditAction,
  MatchType,
  PrismaClient,
  ReminderStatus,
  Scope,
  TaskStatus,
  TimerStatus,
  type MessageDirection,
  type Prisma,
  type User
} from "@prisma/client";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import OpenAI from "openai";
import {
  LlmError,
  resolveRelationshipProfile,
  type CanonicalIdentity,
  type ConversationMessage,
  type InboundMessageEvent,
  type LlmErrorReason,
  type LlmPort,
  type ReminderCreateInput,
  type TimerCreateInput,
  type ConversationState,
  type RelationshipProfile
} from "@zappy/core";
import type { FeatureFlagInput, TriggerInput } from "@zappy/shared";

export const prisma = new PrismaClient();
export const createRedisConnection = (redisUrl: string) => new Redis(redisUrl, { maxRetriesPerRequest: null });
export const createQueue = (queueName: string, redisUrl: string) =>
  new Queue(queueName, { connection: createRedisConnection(redisUrl) as unknown as any });

const scopeOrder: Scope[] = [Scope.USER, Scope.GROUP, Scope.TENANT, Scope.GLOBAL];

const writeAudit = async (actor: string, action: AuditAction, entity: string, entityId: string, metadata?: unknown) => {
  await prisma.auditLog.create({ data: { actor, action, entity, entityId, metadata: metadata as Prisma.JsonObject | undefined } });
};

type DerivedIdentity = {
  waUserId: string;
  phoneNumber?: string | null;
  lidJid?: string | null;
  pnJid?: string | null;
};

const normalizePhoneNumber = (value?: string | null): string | null => {
  if (!value) return null;
  const digits = value.replace(/\\D/g, "");
  return digits.length ? digits : null;
};

const parsePhoneFromJid = (jid?: string | null): string | null => {
  if (!jid) return null;
  const match = jid.match(/^(\\d+)/);
  if (match?.[1]) return normalizePhoneNumber(match[1]);
  return null;
};

const extractIdentityParts = (waUserId: string, remoteJid?: string): DerivedIdentity => {
  const lidJid = waUserId?.endsWith?.("@lid") ? waUserId : remoteJid?.endsWith?.("@lid") ? remoteJid : null;
  const pnJidRaw =
    waUserId?.includes("@s.whatsapp.net") || waUserId?.includes("@c.us")
      ? waUserId
      : remoteJid?.includes?.("@s.whatsapp.net") || remoteJid?.includes?.("@c.us")
        ? remoteJid
        : null;
  const phoneFromId = normalizePhoneNumber(parsePhoneFromJid(pnJidRaw ?? waUserId));
  const pnJid = phoneFromId ? `${phoneFromId}@s.whatsapp.net` : pnJidRaw;
  return {
    waUserId,
    phoneNumber: phoneFromId,
    lidJid,
    pnJid
  };
};

const collectAliases = (...values: Array<string | null | undefined>): string[] => {
  const set = new Set<string>();
  for (const value of values) {
    if (value && value.trim()) set.add(value.trim());
  }
  return Array.from(set);
};

const normalizeLidJid = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.includes("@") ? trimmed : `${trimmed}@lid`;
};

const aliasSeeds: Array<{ lidJid: string; phoneNumber: string; label: string }> = [
  { lidJid: "70029643092123@lid", phoneNumber: "556699064658", label: "creator_root" },
  { lidJid: "151608402911288@lid", phoneNumber: "556692283438", label: "mother_privileged" }
];

const applyAliasSeed = (derived: DerivedIdentity): { applied: boolean; seedLabel?: string } => {
  if (derived.phoneNumber) return { applied: false };
  const lid = normalizeLidJid(derived.lidJid ?? derived.waUserId);
  if (!lid) return { applied: false };
  const match = aliasSeeds.find((seed) => seed.lidJid === lid);
  if (!match) return { applied: false };
  derived.phoneNumber = match.phoneNumber;
  derived.pnJid = `${match.phoneNumber}@s.whatsapp.net`;
  derived.lidJid = lid;
  return { applied: true, seedLabel: match.label };
};

const toRelationshipProfile = (value?: string | null): RelationshipProfile | null => {
  const allowed: RelationshipProfile[] = [
    "creator_root",
    "mother_privileged",
    "delegated_owner",
    "admin",
    "member",
    "external_contact"
  ];
  if (!value) return null;
  return allowed.includes(value as RelationshipProfile) ? (value as RelationshipProfile) : null;
};

const buildCanonicalIdentity = (user: User, derived: DerivedIdentity, extraAliases: string[] = []): CanonicalIdentity => {
  const phoneNumber = user.phoneNumber ?? derived.phoneNumber ?? null;
  const lidJid = user.lidJid ?? derived.lidJid ?? null;
  const pnJid = user.pnJid ?? (phoneNumber ? `${phoneNumber}@s.whatsapp.net` : derived.pnJid ?? null);
  const aliases = collectAliases(
    ...extraAliases,
    user.waUserId,
    lidJid,
    pnJid,
    phoneNumber,
    derived.waUserId,
    derived.lidJid,
    derived.pnJid,
    derived.phoneNumber
  );
  const canonicalUserKey = phoneNumber ?? lidJid ?? pnJid ?? user.waUserId;
  return {
    canonicalUserKey,
    waUserId: user.waUserId,
    phoneNumber,
    lidJid,
    pnJid,
    aliases,
    displayName: user.displayName ?? null,
    permissionRole: user.permissionRole ?? null,
    relationshipProfile: toRelationshipProfile(user.relationshipProfile)
  };
};

const findUserByAnyIdentifier = async (tenantId: string, identifiers: DerivedIdentity, aliases: string[]): Promise<User | null> => {
  const prioritizedFilters: Array<Prisma.UserWhereInput | null> = [
    identifiers.phoneNumber ? { phoneNumber: identifiers.phoneNumber } : null,
    identifiers.pnJid ? { pnJid: identifiers.pnJid } : null,
    identifiers.lidJid ? { lidJid: identifiers.lidJid } : null,
    aliases.length > 0 ? { aliases: { hasSome: aliases } } : null,
    identifiers.waUserId ? { waUserId: identifiers.waUserId } : null
  ];

  for (const filter of prioritizedFilters) {
    if (!filter) continue;
    const user = await prisma.user.findFirst({ where: { tenantId, ...filter } });
    if (user) return user;
  }
  return null;
};

const findUserForTenant = async (tenantId: string, waUserId: string, remoteJid?: string) => {
  const derived = extractIdentityParts(waUserId, remoteJid);
  const aliases = collectAliases(
    waUserId,
    derived.pnJid,
    derived.lidJid,
    derived.phoneNumber,
    derived.phoneNumber ? `${derived.phoneNumber}@s.whatsapp.net` : null
  );
  return findUserByAnyIdentifier(tenantId, derived, aliases);
};

const mergeUserIdentity = async (user: User, derived: DerivedIdentity, aliases: string[], displayName?: string | null) => {
  const updates: Prisma.UserUpdateInput = {};
  const updatedFields: string[] = [];
  if (displayName && !user.displayName) {
    updates.displayName = displayName;
    updatedFields.push("displayName");
  }
  if (derived.phoneNumber && !user.phoneNumber) {
    updates.phoneNumber = derived.phoneNumber;
    updatedFields.push("phoneNumber");
  }
  const normalizedPnJid = derived.phoneNumber ? `${derived.phoneNumber}@s.whatsapp.net` : derived.pnJid ?? null;
  if (normalizedPnJid && !user.pnJid) {
    updates.pnJid = normalizedPnJid;
    updatedFields.push("pnJid");
  }
  if (derived.lidJid && !user.lidJid) {
    updates.lidJid = derived.lidJid;
    updatedFields.push("lidJid");
  }
  const mergedAliases = Array.from(new Set([...(user.aliases ?? []), ...aliases]));
  if (mergedAliases.length !== (user.aliases?.length ?? 0)) {
    updates.aliases = mergedAliases;
    updatedFields.push("aliases");
  }

  if (Object.keys(updates).length > 0) {
    const updated = await prisma.user.update({ where: { id: user.id }, data: updates });
    return { user: updated, updatedFields };
  }
  return { user, updatedFields };
};

export const resolveCanonicalUserIdentity = async (input: {
  tenantId: string;
  waUserId: string;
  remoteJid?: string;
  displayName?: string | null;
  aliases?: string[];
  allowCreate?: boolean;
}): Promise<{ user: User | null; canonical: CanonicalIdentity; created: boolean; updatedFields: string[]; relationship?: RelationshipProfile }> => {
  const derived = extractIdentityParts(input.waUserId, input.remoteJid);
  applyAliasSeed(derived);
  const aliasCandidates = collectAliases(
    ...collectAliases(derived.waUserId, derived.lidJid, derived.pnJid, derived.phoneNumber),
    ...(input.aliases ?? []),
    derived.phoneNumber ? `${derived.phoneNumber}@s.whatsapp.net` : null
  );

  let user = await findUserByAnyIdentifier(input.tenantId, derived, aliasCandidates);
  let created = false;

  if (!user && input.allowCreate !== false) {
    const pnJid = derived.pnJid ?? (derived.phoneNumber ? `${derived.phoneNumber}@s.whatsapp.net` : null);
    user = await prisma.user.create({
      data: {
        tenantId: input.tenantId,
        waUserId: derived.waUserId,
        displayName: input.displayName ?? derived.phoneNumber ?? derived.waUserId,
        phoneNumber: derived.phoneNumber,
        lidJid: derived.lidJid,
        pnJid,
        aliases: aliasCandidates,
        role: "member"
      }
    });
    created = true;
  }

  if (!user) {
    const canonicalUserKey = derived.phoneNumber ?? derived.lidJid ?? derived.pnJid ?? derived.waUserId;
    return {
      user: null,
      canonical: {
        canonicalUserKey,
        waUserId: derived.waUserId,
        phoneNumber: derived.phoneNumber ?? null,
        lidJid: derived.lidJid ?? null,
        pnJid: derived.pnJid ?? null,
        aliases: aliasCandidates,
        displayName: input.displayName ?? null,
        permissionRole: null,
        relationshipProfile: null
      },
      created,
      updatedFields: [],
      relationship: undefined
    };
  }

  const mergeResult = await mergeUserIdentity(user, derived, aliasCandidates, input.displayName);
  user = mergeResult.user;

  const canonical = buildCanonicalIdentity(user, derived, aliasCandidates);
  const relationship = resolveRelationshipProfile({
    waUserId: canonical.waUserId,
    phoneNumber: canonical.phoneNumber,
    pnJid: canonical.pnJid,
    lidJid: canonical.lidJid,
    aliases: canonical.aliases,
    storedProfile: toRelationshipProfile(user.relationshipProfile),
    identityRole: user.permissionRole ?? user.role
  });

  const inferredPermissionRole =
    user.permissionRole ??
    (relationship.profile === "creator_root"
      ? "ROOT"
      : relationship.profile === "mother_privileged"
        ? "PRIVILEGED"
        : null);

  const updates: Prisma.UserUpdateInput = {};
  const updatedFields = [...mergeResult.updatedFields];
  const shouldPersistRelationship =
    (!user.relationshipProfile || toRelationshipProfile(user.relationshipProfile) !== relationship.profile) && relationship.reason !== "stored_profile";
  if (shouldPersistRelationship) {
    updates.relationshipProfile = relationship.profile;
    canonical.relationshipProfile = relationship.profile;
  } else {
    canonical.relationshipProfile = toRelationshipProfile(user.relationshipProfile) ?? relationship.profile;
  }
  if (inferredPermissionRole && user.permissionRole !== inferredPermissionRole) {
    updates.permissionRole = inferredPermissionRole;
    canonical.permissionRole = inferredPermissionRole;
  }
  if (Object.keys(updates).length > 0) {
    user = await prisma.user.update({ where: { id: user.id }, data: updates });
    updatedFields.push(...Object.keys(updates));
  } else if (!canonical.permissionRole) {
    canonical.permissionRole = user.permissionRole ?? null;
  }

  return { user, canonical, created, updatedFields, relationship: relationship.profile };
};

export const ensureTenantContext = async (input: {
  waGroupId?: string;
  waUserId: string;
  defaultTenantName: string;
  onlyGroupId?: string;
  remoteJid?: string;
  userName?: string | null;
}) => {
  let tenant = await prisma.tenant.findFirst({ where: { name: input.defaultTenantName } });
  if (!tenant) tenant = await prisma.tenant.create({ data: { name: input.defaultTenantName } });

  let group = input.waGroupId
    ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } })
    : input.onlyGroupId
      ? await prisma.group.findUnique({ where: { waGroupId: input.onlyGroupId } })
      : null;

  if (!group && (input.waGroupId || input.onlyGroupId)) {
    const waGroupId = input.waGroupId ?? input.onlyGroupId!;
    group = await prisma.group.create({ data: { tenantId: tenant.id, waGroupId, name: waGroupId } });
  }

  const resolvedIdentity = await resolveCanonicalUserIdentity({
    tenantId: tenant.id,
    waUserId: input.waUserId,
    remoteJid: input.remoteJid,
    displayName: input.userName,
    aliases: collectAliases(input.userName)
  });
  const user =
    resolvedIdentity.user ??
    (await prisma.user.create({
      data: {
        tenantId: tenant.id,
        waUserId: input.waUserId,
        displayName: input.userName ?? input.waUserId,
        role: "member"
      }
    }));

  return { tenant, group, user, canonicalIdentity: resolvedIdentity.canonical, relationshipProfile: resolvedIdentity.relationship };
};

export const persistInboundMessage = async (input: InboundMessageEvent & { userId: string; groupId?: string; rawJson: unknown }) => {
  const conversation =
    (await prisma.conversation.findFirst({ where: { tenantId: input.tenantId, groupId: input.groupId ?? null } })) ??
    (await prisma.conversation.create({
      data: { tenantId: input.tenantId, groupId: input.groupId ?? null, subject: input.groupId ?? input.waUserId }
    }));
  return prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId: input.userId,
      body: input.text,
      waMessageId: input.waMessageId,
      direction: "INBOUND",
      rawJson: input.rawJson as Prisma.JsonObject,
      waUserId: input.waUserId,
      waGroupId: input.waGroupId,
      tenantId: input.tenantId
    }
  });
};

export const persistOutboundMessage = async (input: {
  tenantId: string;
  userId?: string;
  groupId?: string;
  waUserId: string;
  waGroupId?: string;
  text: string;
  waMessageId?: string;
  rawJson?: unknown;
}) => {
  const conversation =
    (await prisma.conversation.findFirst({ where: { tenantId: input.tenantId, groupId: input.groupId ?? null } })) ??
    (await prisma.conversation.create({
      data: { tenantId: input.tenantId, groupId: input.groupId ?? null, subject: input.groupId ?? input.waUserId }
    }));
  return prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId: input.userId,
      body: input.text,
      waMessageId: input.waMessageId,
      direction: "OUTBOUND",
      rawJson: (input.rawJson ?? {}) as Prisma.JsonObject,
      waUserId: input.waUserId,
      waGroupId: input.waGroupId,
      tenantId: input.tenantId
    }
  });
};

export const featureFlagRepository = {
  list: () => prisma.featureFlag.findMany({ orderBy: [{ key: "asc" }, { createdAt: "desc" }] }),
  create: async (input: FeatureFlagInput, actor: string) => {
    const created = await prisma.featureFlag.create({
      data: {
        key: input.key,
        description: input.description,
        enabled: input.enabled,
        value: input.value,
        scope: input.scope as Scope,
        tenantId: input.tenantId,
        groupId: input.groupId,
        userId: input.userId
      }
    });
    await writeAudit(actor, AuditAction.CREATE, "FeatureFlag", created.id, created);
    return created;
  },
  update: async (id: string, input: FeatureFlagInput, actor: string) => {
    const updated = await prisma.featureFlag.update({
      where: { id },
      data: {
        key: input.key,
        description: input.description,
        enabled: input.enabled,
        value: input.value,
        scope: input.scope as Scope,
        tenantId: input.tenantId,
        groupId: input.groupId,
        userId: input.userId
      }
    });
    await writeAudit(actor, AuditAction.UPDATE, "FeatureFlag", id, updated);
    return updated;
  },
  remove: async (id: string, actor: string) => {
    await prisma.featureFlag.delete({ where: { id } });
    await writeAudit(actor, AuditAction.DELETE, "FeatureFlag", id);
  }
};

export const triggerRepository = {
  list: () => prisma.trigger.findMany({ orderBy: [{ priority: "desc" }, { createdAt: "desc" }] }),
  create: async (input: TriggerInput, actor: string) => {
    const created = await prisma.trigger.create({
      data: {
        name: input.name,
        pattern: input.pattern,
        responseTemplate: input.responseTemplate,
        matchType: input.matchType as MatchType,
        enabled: input.enabled,
        priority: input.priority,
        cooldownSeconds: input.cooldownSeconds,
        scope: input.scope as Scope,
        tenantId: input.tenantId,
        groupId: input.groupId,
        userId: input.userId
      }
    });
    await writeAudit(actor, AuditAction.CREATE, "Trigger", created.id, created);
    return created;
  },
  update: async (id: string, input: TriggerInput, actor: string) => {
    const updated = await prisma.trigger.update({
      where: { id },
      data: {
        name: input.name,
        pattern: input.pattern,
        responseTemplate: input.responseTemplate,
        matchType: input.matchType as MatchType,
        enabled: input.enabled,
        priority: input.priority,
        cooldownSeconds: input.cooldownSeconds,
        scope: input.scope as Scope,
        tenantId: input.tenantId,
        groupId: input.groupId,
        userId: input.userId
      }
    });
    await writeAudit(actor, AuditAction.UPDATE, "Trigger", id, updated);
    return updated;
  },
  remove: async (id: string, actor: string) => {
    await prisma.trigger.delete({ where: { id } });
    await writeAudit(actor, AuditAction.DELETE, "Trigger", id);
  }
};

export const auditLogRepository = {
  list: (limit: number) => prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit })
};

export const coreFlagsRepository = {
  resolveFlags: async (input: { tenantId: string; waGroupId?: string; waUserId: string }) => {
    const user = await findUserForTenant(input.tenantId, input.waUserId, input.waGroupId);
    const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
    const flags = await prisma.featureFlag.findMany({
      where: {
        enabled: true,
        OR: [
          { scope: Scope.GLOBAL },
          { scope: Scope.TENANT, tenantId: input.tenantId },
          group ? { scope: Scope.GROUP, groupId: group.id } : undefined,
          user ? { scope: Scope.USER, userId: user.id } : undefined
        ].filter(Boolean) as Prisma.FeatureFlagWhereInput[]
      }
    });

    const out: Record<string, string> = {};
    for (const scope of scopeOrder.reverse()) {
      for (const flag of flags.filter((f) => f.scope === scope)) out[flag.key] = flag.value;
    }
    return out;
  }
};

export const coreTriggersRepository = {
  findActiveByScope: async (input: { tenantId: string; waGroupId?: string; waUserId: string }) => {
    const user = await findUserForTenant(input.tenantId, input.waUserId, input.waGroupId);
    const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
    const rows = await prisma.trigger.findMany({
      where: {
        enabled: true,
        OR: [
          { scope: Scope.GLOBAL },
          { scope: Scope.TENANT, tenantId: input.tenantId },
          group ? { scope: Scope.GROUP, groupId: group.id } : undefined,
          user ? { scope: Scope.USER, userId: user.id } : undefined
        ].filter(Boolean) as Prisma.TriggerWhereInput[]
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }]
    });
    return rows.map((row) => ({ ...row, matchType: row.matchType as "CONTAINS" | "REGEX" | "STARTS_WITH", scope: row.scope as "GLOBAL" | "TENANT" | "GROUP" | "USER" }));
  }
};

export const tasksRepository = {
  addTask: async (input: { tenantId: string; title: string; createdByWaUserId: string; waGroupId?: string; runAt?: Date | null }) => {
    const user = await findUserForTenant(input.tenantId, input.createdByWaUserId, input.waGroupId);
    const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
    const row = await prisma.task.create({
      data: {
        tenantId: input.tenantId,
        groupId: group?.id,
        userId: user?.id,
        waGroupId: input.waGroupId,
        waUserId: input.createdByWaUserId,
        type: "TASK",
        payload: { title: input.title, createdByWaUserId: input.createdByWaUserId },
        status: TaskStatus.PENDING,
        runAt: input.runAt ?? null
      }
    });
    return { id: row.id, title: input.title };
  },
  listTasks: async (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => {
    const where: Prisma.TaskWhereInput = {
      tenantId: input.tenantId,
      type: "TASK",
      waGroupId: input.waGroupId ?? undefined,
      waUserId: input.waGroupId ? undefined : input.waUserId
    };
    const rows = await prisma.task.findMany({ where, orderBy: { createdAt: "desc" }, take: 20 });
    return rows.map((row) => ({ id: row.id, title: String((row.payload as Prisma.JsonObject).title ?? "untitled"), done: row.status === TaskStatus.DONE, runAt: row.runAt }));
  },
  listTasksForDay: async (input: { tenantId: string; waGroupId?: string; waUserId?: string; dayStart: Date; dayEnd: Date }) => {
    const where: Prisma.TaskWhereInput = {
      tenantId: input.tenantId,
      type: "TASK",
      waGroupId: input.waGroupId ?? undefined,
      waUserId: input.waGroupId ? undefined : input.waUserId,
      OR: [
        { runAt: { gte: input.dayStart, lte: input.dayEnd } },
        { AND: [{ runAt: null }, { createdAt: { gte: input.dayStart, lte: input.dayEnd } }] }
      ]
    };
    const rows = await prisma.task.findMany({ where, orderBy: { createdAt: "asc" }, take: 50 });
    return rows.map((row) => ({ id: row.id, title: String((row.payload as Prisma.JsonObject).title ?? "untitled"), done: row.status === TaskStatus.DONE, runAt: row.runAt }));
  },
  markDone: async (input: { tenantId: string; taskId: string; waGroupId?: string; waUserId?: string }) => {
    const row = await prisma.task.findFirst({ where: { id: input.taskId, tenantId: input.tenantId, type: "TASK", waGroupId: input.waGroupId ?? undefined, waUserId: input.waGroupId ? undefined : input.waUserId } });
    if (!row) return false;
    await prisma.task.update({ where: { id: row.id }, data: { status: TaskStatus.DONE } });
    return true;
  },
  updateTask: async (input: { tenantId: string; taskId: string; title?: string; runAt?: Date | null; waGroupId?: string; waUserId?: string }) => {
    const row = await prisma.task.findFirst({
      where: { id: input.taskId, tenantId: input.tenantId, type: "TASK", waGroupId: input.waGroupId ?? undefined, waUserId: input.waGroupId ? undefined : input.waUserId }
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
      where: { id: input.taskId, tenantId: input.tenantId, type: "TASK", waGroupId: input.waGroupId ?? undefined, waUserId: input.waGroupId ? undefined : input.waUserId }
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

export const remindersRepository = {
  createReminder: async (input: ReminderCreateInput) => {
    const user = await findUserForTenant(input.tenantId, input.waUserId, input.waGroupId);
    const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
    return prisma.reminder.create({
      data: {
        tenantId: input.tenantId,
        userId: user?.id,
        groupId: group?.id,
        message: input.message,
        remindAt: input.remindAt,
        status: ReminderStatus.SCHEDULED,
        waUserId: input.waUserId,
        waGroupId: input.waGroupId
      },
      select: { id: true, status: true }
    });
  },
  listForDay: async (input: { tenantId: string; waGroupId?: string; waUserId: string; dayStart: Date; dayEnd: Date }) => {
    const where: Prisma.ReminderWhereInput = {
      tenantId: input.tenantId,
      waGroupId: input.waGroupId ?? undefined,
      waUserId: input.waGroupId ? undefined : input.waUserId,
      remindAt: { gte: input.dayStart, lte: input.dayEnd },
      status: ReminderStatus.SCHEDULED
    };
    const rows = await prisma.reminder.findMany({ where, orderBy: { remindAt: "asc" } });
    return rows.map((row) => ({ id: row.id, status: row.status, remindAt: row.remindAt, message: row.message }));
  },
  updateReminder: async (input: { tenantId: string; reminderId: string; waGroupId?: string; waUserId?: string; message?: string; remindAt?: Date }) => {
    const row = await prisma.reminder.findFirst({
      where: { id: input.reminderId, tenantId: input.tenantId, waGroupId: input.waGroupId ?? undefined, waUserId: input.waGroupId ? undefined : input.waUserId }
    });
    if (!row) return null;
    const data: Prisma.ReminderUpdateInput = {};
    if (input.message) data.message = input.message;
    if (input.remindAt) data.remindAt = input.remindAt;
    const updated = await prisma.reminder.update({ where: { id: row.id }, data });
    return { id: updated.id, status: updated.status, remindAt: updated.remindAt, message: updated.message };
  },
  deleteReminder: async (input: { tenantId: string; reminderId: string; waGroupId?: string; waUserId?: string }) => {
    const row = await prisma.reminder.findFirst({
      where: { id: input.reminderId, tenantId: input.tenantId, waGroupId: input.waGroupId ?? undefined, waUserId: input.waGroupId ? undefined : input.waUserId }
    });
    if (!row) return false;
    await prisma.reminder.update({ where: { id: row.id }, data: { status: ReminderStatus.CANCELED } });
    return true;
  },
  countScheduled: async (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => {
    const where: Prisma.ReminderWhereInput = {
      tenantId: input.tenantId,
      status: ReminderStatus.SCHEDULED,
      waGroupId: input.waGroupId ?? undefined,
      waUserId: input.waGroupId ? undefined : input.waUserId
    };
    return prisma.reminder.count({ where });
  }
};

export const notesRepository = {
  addNote: async (input: { tenantId: string; waGroupId?: string; waUserId: string; text: string; scope: Scope }) => {
    const user = await findUserForTenant(input.tenantId, input.waUserId, input.waGroupId);
    const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
    const last = await prisma.note.findFirst({
      where: { tenantId: input.tenantId, scope: input.scope, groupId: group?.id ?? null, userId: user?.id ?? null },
      orderBy: { sequence: "desc" }
    });
    const nextSeq = (last?.sequence ?? 0) + 1;
    const publicId = `N${String(nextSeq).padStart(3, "0")}`;
    const row = await prisma.note.create({
      data: {
        tenantId: input.tenantId,
        groupId: group?.id,
        userId: user?.id,
        waGroupId: input.waGroupId,
        waUserId: input.waUserId,
        scope: input.scope,
        text: input.text,
        sequence: nextSeq,
        publicId
      }
    });
    return { id: row.id, publicId: row.publicId, text: row.text, createdAt: row.createdAt, scope: row.scope as Scope };
  },
  listNotes: async (input: { tenantId: string; waGroupId?: string; waUserId: string; scope: Scope; limit?: number }) => {
    const user = await findUserForTenant(input.tenantId, input.waUserId, input.waGroupId);
    const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
    const rows = await prisma.note.findMany({
      where: { tenantId: input.tenantId, scope: input.scope, groupId: group?.id ?? null, userId: user?.id ?? null },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 10
    });
    return rows.map((row) => ({ id: row.id, publicId: row.publicId, text: row.text, createdAt: row.createdAt, scope: row.scope as Scope }));
  },
  removeNote: async (input: { tenantId: string; waGroupId?: string; waUserId: string; publicId: string }) => {
    const user = await findUserForTenant(input.tenantId, input.waUserId, input.waGroupId);
    const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
    const note = await prisma.note.findFirst({ where: { tenantId: input.tenantId, publicId: input.publicId, groupId: group?.id ?? null, userId: user?.id ?? null } });
    if (!note) return false;
    await prisma.note.delete({ where: { id: note.id } });
    return true;
  }
};

export const timersRepository = {
  createTimer: async (input: TimerCreateInput) => {
    const user = await findUserForTenant(input.tenantId, input.waUserId, input.waGroupId);
    const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
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

export const messagesRepository = {
  getRecentMessages: async (input: { tenantId: string; waGroupId?: string; waUserId: string; limit: number }): Promise<ConversationMessage[]> => {
    const rows = await prisma.message.findMany({
      where: { tenantId: input.tenantId, waUserId: input.waUserId, waGroupId: input.waGroupId },
      orderBy: { createdAt: "desc" },
      take: input.limit
    });
    return rows.reverse().map((row) => ({ role: row.direction === "INBOUND" ? "user" : "assistant", content: row.body }));
  }
};

export const promptsRepository = {
  resolvePrompt: async (input: { tenantId: string; waGroupId?: string }) => {
    if (input.waGroupId) {
      const group = await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } });
      if (group) {
        const gPrompt = await prisma.prompt.findFirst({ where: { groupId: group.id }, orderBy: { createdAt: "desc" } });
        if (gPrompt) return gPrompt.content;
      }
    }
    const tPrompt = await prisma.prompt.findFirst({ where: { tenantId: input.tenantId, groupId: null }, orderBy: { createdAt: "desc" } });
    return tPrompt?.content ?? null;
  }
};

export const conversationMemoryRepository = {
  appendMemory: async (input: {
    tenantId: string;
    conversationId: string;
    waUserId?: string;
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    metadataJson?: unknown;
    keepLatest?: number;
  }): Promise<void> => {
    const content = input.content?.trim();
    if (!content) return;
    await prisma.conversationMemory.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        waUserId: input.waUserId ?? null,
        role: input.role as any,
        content,
        metadataJson: (input.metadataJson as Prisma.InputJsonValue) ?? undefined
      }
    });
    if (input.keepLatest && input.keepLatest > 0) {
      await conversationMemoryRepository.trimOldMemory(input.conversationId, input.keepLatest);
    }
  },

  listRecentMemory: async (input: { conversationId: string; limit: number }) => {
    const rows = await prisma.conversationMemory.findMany({
      where: { conversationId: input.conversationId },
      orderBy: { createdAt: "desc" },
      take: input.limit
    });
    return rows.reverse();
  },

  trimOldMemory: async (conversationId: string, keepLatestN: number) => {
    if (keepLatestN <= 0) {
      await prisma.conversationMemory.deleteMany({ where: { conversationId } });
      return;
    }
    const stale = await prisma.conversationMemory.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      skip: keepLatestN,
      select: { id: true }
    });
    if (stale.length === 0) return;
    await prisma.conversationMemory.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  },

  clearMemory: async (conversationId: string) => {
    await prisma.conversationMemory.deleteMany({ where: { conversationId } });
  }
};

// Aliases to satisfy ConversationMemoryPort shape used by @zappy/ai
(conversationMemoryRepository as any).loadRecent = (input: { tenantId: string; conversationId: string; limit: number }) =>
  conversationMemoryRepository.listRecentMemory({ conversationId: input.conversationId, limit: input.limit });
(conversationMemoryRepository as any).append = (entry: {
  tenantId: string;
  conversationId: string;
  waUserId?: string;
  waGroupId?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  metadataJson?: unknown;
  keep?: number;
}) =>
  conversationMemoryRepository.appendMemory({
    tenantId: entry.tenantId,
    conversationId: entry.conversationId,
    waUserId: entry.waUserId,
    role: entry.role,
    content: entry.content,
    metadataJson: entry.metadataJson,
    keepLatest: entry.keep
  });

export const createCooldownAdapter = (redis: Redis) => ({
  canFire: async (key: string, ttlSeconds: number) => {
    if (ttlSeconds <= 0) return true;
    const set = await redis.set(key, "1", "EX", ttlSeconds, "NX");
    return set === "OK";
  }
});

export const createRateLimitAdapter = (redis: Redis) => ({
  allow: async (key: string, max: number, windowSeconds: number) => {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count <= max;
  }
});

export const createQueueAdapter = (queue: Queue) => ({
  enqueueReminder: async (reminderId: string, runAt: Date) => {
    const delay = Math.max(0, runAt.getTime() - Date.now());
    await queue.remove(reminderId).catch(() => {});
    const job = await queue.add("send-reminder", { reminderId }, { jobId: reminderId, delay });
    return { jobId: String(job.id) };
  },
  enqueueTimer: async (timerId: string, runAt: Date) => {
    const delay = Math.max(0, runAt.getTime() - Date.now());
    await queue.remove(timerId).catch(() => {});
    const job = await queue.add("fire-timer", { timerId }, { jobId: timerId, delay });
    return { jobId: String(job.id) };
  }
});

const classifyOpenAiError = (error: unknown): { reason: LlmErrorReason; status?: number; code?: string } => {
  const asAny = error as { status?: unknown; code?: unknown; type?: unknown };
  const status = typeof asAny?.status === "number" ? asAny.status : undefined;
  const code = typeof asAny?.code === "string" ? asAny.code : undefined;
  const type = typeof asAny?.type === "string" ? asAny.type : undefined;

  if (code === "insufficient_quota" || type === "insufficient_quota") return { reason: "insufficient_quota", status, code };
  if (status === 429 || code === "rate_limit_exceeded" || type === "rate_limit_exceeded") return { reason: "rate_limit", status, code };
  if (status === 408 || code === "ETIMEDOUT" || code === "ETIMEOUT") return { reason: "timeout", status, code };
  if (code && ["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH"].includes(code)) return { reason: "network", status, code };
  if (status && status >= 500) return { reason: "network", status, code };

  return { reason: "unknown", status, code };
};

export const createOpenAiAdapter = (apiKey: string | undefined, model: string): LlmPort => {
  const client = apiKey ? new OpenAI({ apiKey }) : null;
  return {
    chat: async (input: { system: string; messages: ConversationMessage[] }) => {
      if (!client) return "Assistant is not configured.";
      try {
        const completion = await client.chat.completions.create({
          model,
          messages: [{ role: "system", content: input.system }, ...input.messages]
        });
        return completion.choices[0]?.message?.content ?? "";
      } catch (error) {
        const { reason, status, code } = classifyOpenAiError(error);
        throw new LlmError(reason, "LLM request failed", { status, code, cause: error });
      }
    }
  };
};

export const markGatewayHeartbeat = async (redis: Redis, isConnected: boolean) => {
  await redis.set("gateway:heartbeat", JSON.stringify({ isConnected, at: new Date().toISOString() }), "EX", 30);
};

export const getGatewayHeartbeat = async (redis: Redis) => {
  const raw = await redis.get("gateway:heartbeat");
  return raw ? (JSON.parse(raw) as { isConnected: boolean; at: string }) : { isConnected: false, at: null };
};

export const markWorkerHeartbeat = async (redis: Redis) => {
  await redis.set("worker:heartbeat", JSON.stringify({ ok: true, at: new Date().toISOString() }), "EX", 30);
};

export const getWorkerHeartbeat = async (redis: Redis) => {
  const raw = await redis.get("worker:heartbeat");
  return raw ? (JSON.parse(raw) as { ok: boolean; at: string }) : { ok: false, at: null };
};

export const getRecentMessages = (limit: number) =>
  prisma.message.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, body: true, createdAt: true, waUserId: true, waGroupId: true, direction: true } });

export const getReminderById = (id: string) => prisma.reminder.findUnique({ where: { id } });
export const updateReminderStatus = (id: string, status: ReminderStatus) => prisma.reminder.update({ where: { id }, data: { status } });

export const getTimerById = (id: string) => prisma.timer.findUnique({ where: { id } });
export const updateTimerStatus = (id: string, status: TimerStatus) => prisma.timer.update({ where: { id }, data: { status } });

export type WhatsAppSender = (to: string, text: string) => Promise<{ messageId?: string; raw?: unknown }>;

export const markReminderMessage = async (input: { reminderId: string; messageId?: string }) => {
  await prisma.reminder.update({ where: { id: input.reminderId }, data: { sentMessageId: input.messageId } });
};

export const markTimerMessage = async (input: { timerId: string; messageId?: string }) => {
  await prisma.timer.update({ where: { id: input.timerId }, data: { sentMessageId: input.messageId } });
};

export const createMuteAdapter = (redis: Redis) => ({
  getMuteState: async (input: { tenantId: string; scope: Scope; scopeId: string }) => {
    const key = `mute:${input.tenantId}:${input.scope}:${input.scopeId}`;
    const raw = await redis.get(key);
    if (!raw) return null;
    const until = new Date(raw);
    if (Number.isNaN(until.getTime())) return null;
    if (until.getTime() <= Date.now()) {
      await redis.del(key);
      return null;
    }
    return { until };
  },
  mute: async (input: { tenantId: string; scope: Scope; scopeId: string; durationMs: number; now: Date }) => {
    const key = `mute:${input.tenantId}:${input.scope}:${input.scopeId}`;
    const until = new Date(input.now.getTime() + input.durationMs);
    const ttlSeconds = Math.max(1, Math.round(input.durationMs / 1000));
    await redis.set(key, until.toISOString(), "EX", ttlSeconds);
    return { until };
  },
  unmute: async (input: { tenantId: string; scope: Scope; scopeId: string }) => {
    const key = `mute:${input.tenantId}:${input.scope}:${input.scopeId}`;
    await redis.del(key);
  }
});

export const createConversationStateAdapter = (redis: Redis) => {
  const keyFor = (input: { tenantId: string; waGroupId?: string; waUserId: string }) =>
    `cstate:${input.tenantId}:${input.waGroupId ?? "direct"}:${input.waUserId}`;

  return {
    getState: async (input: { tenantId: string; waGroupId?: string; waUserId: string }) => {
      const key = keyFor(input);
      const raw = await redis.get(key);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { state?: ConversationState; context?: Record<string, unknown>; updatedAt?: string; expiresAt?: string | null };
        return {
          state: parsed.state ?? "NONE",
          context: parsed.context,
          updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt) : new Date(),
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null
        };
      } catch {
        return null;
      }
    },
    setState: async (input: { tenantId: string; waGroupId?: string; waUserId: string; state: ConversationState; context?: Record<string, unknown>; expiresAt?: Date | null }) => {
      const key = keyFor(input);
      const ttlSeconds = input.expiresAt ? Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 1000)) : 3600;
      const payload = {
        state: input.state,
        context: input.context ?? {},
        updatedAt: new Date().toISOString(),
        expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null
      };
      await redis.set(key, JSON.stringify(payload), "EX", ttlSeconds);
    },
    clearState: async (input: { tenantId: string; waGroupId?: string; waUserId: string }) => {
      const key = keyFor(input);
      await redis.del(key);
    }
  };
};

const mergeUsers = async (sourceId: string, targetId: string) => {
  if (sourceId === targetId) return;
  await prisma.$transaction([
    prisma.message.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.reminder.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.featureFlag.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.trigger.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.task.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.note.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.timer.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.user.delete({ where: { id: sourceId } })
  ]);
};

export const identityRepository = {
  getIdentity: async (input: { tenantId: string; waUserId: string; waGroupId?: string }) => {
    const resolved = await resolveCanonicalUserIdentity({
      tenantId: input.tenantId,
      waUserId: input.waUserId,
      remoteJid: input.waGroupId,
      allowCreate: false
    });
    const user = resolved.user;
    const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
    const role = user?.role ?? "member";
    const permissionRole = user?.permissionRole ?? null;
    const basePermissions = ["task", "reminder", "note", "agenda", "calc", "timer", "status"];
    const adminPermissions = ["admin:flags", "admin:triggers", "admin:status"];
    const effectiveRole = (permissionRole ?? role)?.toLowerCase?.() ?? "member";
    const elevated = ["admin", "root", "owner"].includes(effectiveRole);
    const permissions = elevated ? [...basePermissions, ...adminPermissions] : basePermissions;
    const canonical = resolved.canonical;
    const relationship = resolveRelationshipProfile({
      waUserId: canonical.waUserId,
      phoneNumber: canonical.phoneNumber,
      pnJid: canonical.pnJid,
      lidJid: canonical.lidJid,
      aliases: canonical.aliases,
      storedProfile: canonical.relationshipProfile ?? null,
      identityRole: permissionRole ?? role
    });

    return {
      displayName: user?.displayName ?? canonical.displayName ?? canonical.phoneNumber ?? canonical.waUserId,
      role,
      permissionRole,
      permissions,
      groupName: group?.name,
      canonicalIdentity: { ...canonical, relationshipProfile: relationship.profile },
      relationshipProfile: relationship.profile,
      relationshipReason: relationship.reason
    };
  },
  linkAlias: async (input: { tenantId: string; phoneNumber: string; lidJid: string; actor?: string }) => {
    const phoneNumber = normalizePhoneNumber(input.phoneNumber);
    if (!phoneNumber) throw new Error("Invalid phone number");
    const lidJid = normalizeLidJid(input.lidJid);
    if (!lidJid) throw new Error("Invalid LID identifier");
    const pnJid = `${phoneNumber}@s.whatsapp.net`;
    const aliasTokens = collectAliases(lidJid, pnJid, phoneNumber, input.phoneNumber, `${phoneNumber}@c.us`);

    const phoneDerived: DerivedIdentity = { waUserId: pnJid, phoneNumber, pnJid, lidJid };
    let targetUser =
      (await findUserByAnyIdentifier(input.tenantId, phoneDerived, aliasTokens)) ??
      (await prisma.user.create({
        data: {
          tenantId: input.tenantId,
          waUserId: pnJid,
          phoneNumber,
          pnJid,
          lidJid: null,
          aliases: aliasTokens,
          role: "member",
          displayName: phoneNumber
        }
      }));

    const lidUser = await findUserByAnyIdentifier(
      input.tenantId,
      { waUserId: lidJid, phoneNumber: null, pnJid: null, lidJid },
      aliasTokens
    );

    if (lidUser && lidUser.id !== targetUser.id) {
      await mergeUsers(lidUser.id, targetUser.id);
    }

    const mergedAliases = Array.from(new Set([...(targetUser.aliases ?? []), ...(lidUser?.aliases ?? []), ...aliasTokens]));
    const updates: Prisma.UserUpdateInput = {};
    if (!targetUser.phoneNumber) updates.phoneNumber = phoneNumber;
    if (!targetUser.pnJid) updates.pnJid = pnJid;
    if (!targetUser.lidJid) updates.lidJid = lidJid;
    updates.aliases = mergedAliases;
    if (!targetUser.displayName) updates.displayName = phoneNumber;

    const resolvedPhoneNumber = targetUser.phoneNumber ?? phoneNumber;
    const resolvedPnJid = targetUser.pnJid ?? pnJid;
    const resolvedLidJid = targetUser.lidJid ?? lidJid;

    const relationship = resolveRelationshipProfile({
      waUserId: targetUser.waUserId,
      phoneNumber: resolvedPhoneNumber,
      pnJid: resolvedPnJid,
      lidJid: resolvedLidJid,
      aliases: mergedAliases,
      storedProfile: toRelationshipProfile(targetUser.relationshipProfile),
      identityRole: targetUser.permissionRole ?? targetUser.role
    });
    const inferredPermissionRole =
      targetUser.permissionRole ??
      (relationship.profile === "creator_root"
        ? "ROOT"
        : relationship.profile === "mother_privileged"
          ? "PRIVILEGED"
          : null);

    if (!targetUser.relationshipProfile || toRelationshipProfile(targetUser.relationshipProfile) !== relationship.profile) {
      updates.relationshipProfile = relationship.profile;
    }
    if (inferredPermissionRole && targetUser.permissionRole !== inferredPermissionRole) {
      updates.permissionRole = inferredPermissionRole;
    }

    const updatedUser =
      Object.keys(updates).length > 0 ? await prisma.user.update({ where: { id: targetUser.id }, data: updates }) : targetUser;

    const canonical = buildCanonicalIdentity(updatedUser, { ...phoneDerived, waUserId: updatedUser.waUserId });
    canonical.permissionRole = updatedUser.permissionRole ?? canonical.permissionRole;
    canonical.relationshipProfile = toRelationshipProfile(updatedUser.relationshipProfile) ?? canonical.relationshipProfile;

    await writeAudit(input.actor ?? "system", AuditAction.UPDATE, "User", updatedUser.id, {
      action: "link_alias",
      phoneNumber,
      lidJid
    });

    return {
      user: updatedUser,
      canonicalIdentity: canonical,
      relationshipProfile: canonical.relationshipProfile ?? relationship.profile,
      permissionRole: canonical.permissionRole ?? inferredPermissionRole ?? null
    };
  }
};

export const createStatusPort = (deps: {
  redis: Redis;
  queue: Queue;
  llmEnabled: boolean;
  llmConfigured: boolean;
}) => ({
  getStatus: async (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => {
    const [dbOk, redisOk, gateway, worker, waiting, active, delayed, tasksOpen, remindersScheduled, timersScheduled] = await Promise.all([
      prisma
        .$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
      deps.redis
        .ping()
        .then(() => true)
        .catch(() => false),
      getGatewayHeartbeat(deps.redis),
      getWorkerHeartbeat(deps.redis),
      deps.queue.getWaitingCount(),
      deps.queue.getActiveCount(),
      deps.queue.getDelayedCount(),
      tasksRepository.countOpen({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.waUserId }),
      remindersRepository.countScheduled({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.waUserId }),
      timersRepository.countScheduled({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.waUserId })
    ]);

    return {
      gateway: { ok: gateway.isConnected, at: gateway.at },
      worker: { ok: worker.ok, at: worker.at },
      db: { ok: dbOk },
      redis: { ok: redisOk },
      llm: { enabled: deps.llmEnabled, ok: deps.llmEnabled ? deps.llmConfigured : false, reason: deps.llmEnabled && !deps.llmConfigured ? "missing-key" : undefined },
      counts: { tasksOpen, remindersScheduled, timersScheduled },
      queue: { waiting, active, delayed }
    };
  }
});
