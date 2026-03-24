import {
  AuditAction,
  MatchType,
  PrismaClient,
  ConsentStatus,
  ChatMode,
  ReminderStatus,
  Scope,
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
  type ConversationState,
  type RelationshipProfile,
  type MetricKey,
  type AuditEvent
} from "@zappy/core";
import type { FeatureFlagInput, TriggerInput } from "@zappy/shared";
import { createLogger } from "@zappy/shared";
import { createTasksRepository } from "./tasks/repository.js";
import { createRemindersRepository } from "./reminders/repository.js";
import { createNotesRepository } from "./notes/repository.js";
import { createTimersRepository } from "./timers/repository.js";
import type { ScopedResolver } from "./shared/scoped-resolver.js";
import { createGroupAccessRepository } from "./groups/repository.js";
import { createBotAdminRepository } from "./identity/bot-admin-repository.js";

export const prisma = new PrismaClient();
export const createRedisConnection = (redisUrl: string) => new Redis(redisUrl, { maxRetriesPerRequest: null });
export const createQueue = (queueName: string, redisUrl: string) =>
  new Queue(queueName, { connection: createRedisConnection(redisUrl) as unknown as any });

const metricKeys: MetricKey[] = [
  "messages_received_total",
  "commands_executed_total",
  "trigger_matches_total",
  "ai_requests_total",
  "ai_failures_total",
  "reminders_created_total",
  "reminders_sent_total",
  "moderation_actions_total",
  "onboarding_pending_total",
  "onboarding_accepted_total"
];

export const createMetricsRecorder = (redis: Redis) => {
  const key = (metric: MetricKey) => `metrics:${metric}`;
  return {
    increment: async (metric: MetricKey, by = 1) => {
      if (!by) return;
      await redis.incrby(key(metric), by);
    },
    getSnapshot: async (metrics: MetricKey[] = metricKeys) => {
      const keys = metrics.map(key);
      const values = await redis.mget(keys);
      const snapshot: Record<MetricKey, number> = {} as Record<MetricKey, number>;
      metrics.forEach((metric, idx) => {
        const raw = values?.[idx];
        snapshot[metric] = raw ? Number(raw) : 0;
      });
      return snapshot;
    }
  };
};

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

const identityLogger = createLogger("identity-resolver");

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

const resolveScopedUserAndGroup: ScopedResolver = async (input: { tenantId: string; waUserId: string; waGroupId?: string }) => {
  const user = await findUserForTenant(input.tenantId, input.waUserId, input.waGroupId);
  const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
  return { user, group };
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
}): Promise<{
  user: User | null;
  canonical: CanonicalIdentity;
  created: boolean;
  updatedFields: string[];
  relationship?: RelationshipProfile;
  relationshipReason?: string;
  permissionRoleSource?: string;
}> => {
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
  const storedRelationshipProfile = toRelationshipProfile(user.relationshipProfile);
  const storedPermissionRole = user.permissionRole ?? null;
  const relationship = resolveRelationshipProfile({
    waUserId: canonical.waUserId,
    phoneNumber: canonical.phoneNumber,
    pnJid: canonical.pnJid,
    lidJid: canonical.lidJid,
    aliases: canonical.aliases,
    storedProfile: storedRelationshipProfile,
    identityRole: user.permissionRole ?? user.role
  });

  const privilegedPermissionRole =
    relationship.profile === "creator_root"
      ? "ROOT"
      : relationship.profile === "mother_privileged"
        ? "PRIVILEGED"
        : null;
  const permissionRoleTarget = privilegedPermissionRole ?? storedPermissionRole ?? null;

  const updates: Prisma.UserUpdateInput = {};
  const updatedFields = [...mergeResult.updatedFields];
  const shouldPersistRelationship =
    (!user.relationshipProfile || toRelationshipProfile(user.relationshipProfile) !== relationship.profile) && relationship.reason !== "stored_profile";
  if (shouldPersistRelationship) {
    updates.relationshipProfile = relationship.profile;
    canonical.relationshipProfile = relationship.profile;
  } else {
    canonical.relationshipProfile = storedRelationshipProfile ?? relationship.profile;
  }
  const shouldUpdatePermission = permissionRoleTarget !== null && permissionRoleTarget !== storedPermissionRole;
  if (shouldUpdatePermission) {
    updates.permissionRole = permissionRoleTarget;
    canonical.permissionRole = permissionRoleTarget;
  }
  if (Object.keys(updates).length > 0) {
    user = await prisma.user.update({ where: { id: user.id }, data: updates });
    updatedFields.push(...Object.keys(updates));
  } else if (!canonical.permissionRole) {
    canonical.permissionRole = storedPermissionRole;
  }

  return {
    user,
    canonical,
    created,
    updatedFields,
    relationship: relationship.profile,
    relationshipReason: relationship.reason,
    permissionRoleSource: shouldUpdatePermission
      ? "privileged_override"
      : storedPermissionRole
        ? "stored_permission_role"
        : permissionRoleTarget
          ? "inferred_from_privileged_profile"
          : "none"
  };
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
    const shouldAutoAllow = Boolean(input.onlyGroupId && input.onlyGroupId === waGroupId);
    group = await prisma.group.create({
      data: {
        tenantId: tenant.id,
        waGroupId,
        name: waGroupId,
        allowed: shouldAutoAllow,
        chatMode: ChatMode.ON,
        isOpen: true,
        welcomeEnabled: false,
        moderationConfig: {}
      }
    });
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

  if (process.env.NODE_ENV !== "production") {
    const relationshipSource =
      resolvedIdentity.relationshipReason?.startsWith("match:")
        ? "privileged_override"
        : resolvedIdentity.relationshipReason === "stored_profile"
          ? "db"
          : resolvedIdentity.relationshipReason?.startsWith("role:")
            ? "role"
            : "default";
    const permissionRoleSource = resolvedIdentity.permissionRoleSource ?? (resolvedIdentity.canonical.permissionRole ? "db" : "none");
    const permissionRole = resolvedIdentity.canonical.permissionRole ?? user.permissionRole ?? user.role;
    const relationshipProfile = resolvedIdentity.relationship ?? resolvedIdentity.canonical.relationshipProfile ?? null;
    identityLogger.debug(
      {
        stage: "ensureTenantContext",
        tenantId: tenant.id,
        waUserId: input.waUserId,
        phoneNumber: resolvedIdentity.canonical.phoneNumber,
        pnJid: resolvedIdentity.canonical.pnJid,
        lidJid: resolvedIdentity.canonical.lidJid,
        relationshipProfile,
        relationshipReason: resolvedIdentity.relationshipReason,
        relationshipSource,
        permissionRole,
        permissionRoleSource,
        matchedPrivilegedRule: resolvedIdentity.relationshipReason?.startsWith("match:") ?? false,
        updatedFields: resolvedIdentity.updatedFields,
        created: resolvedIdentity.created
      },
      "identity resolved"
    );
  }

  return {
    tenant,
    group,
    user,
    canonicalIdentity: resolvedIdentity.canonical,
    relationshipProfile: resolvedIdentity.relationship,
    relationshipReason: resolvedIdentity.relationshipReason,
    permissionRoleSource: resolvedIdentity.permissionRoleSource
  };
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

export const commandLogRepository = {
  record: async (input: {
    tenantId: string;
    waUserId: string;
    waGroupId?: string;
    conversationId?: string | null;
    command: string;
    inputText?: string | null;
    resultSummary?: string | null;
    status: string;
    metadata?: unknown;
  }) =>
    prisma.commandLog.create({
      data: {
        tenantId: input.tenantId,
        waUserId: input.waUserId,
        waGroupId: input.waGroupId,
        conversationId: input.conversationId ?? null,
        command: input.command,
        inputText: input.inputText ?? null,
        resultSummary: input.resultSummary ?? null,
        status: input.status,
        metadata: (input.metadata as Prisma.JsonValue) ?? undefined
      }
    }),
  list: (limit: number) =>
    prisma.commandLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit
    })
};

export const createAuditTrail = () => ({
  record: async (event: AuditEvent): Promise<void> => {
    if (event.kind === "command") {
      await commandLogRepository.record({
        tenantId: event.tenantId,
        waUserId: event.waUserId,
        waGroupId: event.waGroupId,
        conversationId: event.conversationId,
        command: event.command,
        inputText: event.inputText,
        resultSummary: event.resultSummary,
        status: event.status,
        metadata: event.metadata
      });
      return;
    }

    if (event.kind === "trigger") {
      await writeAudit(
        event.actor ?? event.waUserId ?? "system",
        AuditAction.PROCESS,
        "Trigger",
        event.triggerId ?? event.triggerName ?? "unknown",
        {
          triggerName: event.triggerName,
          triggerId: event.triggerId,
          waUserId: event.waUserId,
          waGroupId: event.waGroupId,
          conversationId: event.conversationId,
          tenantId: event.tenantId
        }
      );
      return;
    }

    if (event.kind === "consent") {
      await writeAudit(event.actor ?? event.waUserId ?? "system", AuditAction.PROCESS, "Consent", event.waUserId, {
        status: event.status,
        version: event.version,
        waGroupId: event.waGroupId,
        tenantId: event.tenantId
      });
      return;
    }

    if (event.kind === "reminder") {
      await writeAudit(event.actor ?? event.waUserId ?? "system", AuditAction.PROCESS, "Reminder", event.reminderId, {
        status: event.status,
        waUserId: event.waUserId,
        waGroupId: event.waGroupId,
        tenantId: event.tenantId,
        message: event.message
      });
      return;
    }

    if (event.kind === "moderation") {
      await writeAudit(event.actor ?? event.waUserId ?? "system", AuditAction.PROCESS, "Moderation", event.waGroupId ?? event.tenantId, {
        action: event.action,
        targetWaUserId: event.targetWaUserId,
        success: event.success,
        result: event.result,
        tenantId: event.tenantId
      });
      return;
    }

    if (event.kind === "settings") {
      await writeAudit(event.actor ?? event.waUserId ?? "system", AuditAction.UPDATE, "Setting", `${event.scope}:${event.key}`, {
        value: event.value,
        waGroupId: event.waGroupId,
        tenantId: event.tenantId,
        scope: event.scope,
        action: event.action
      });
      return;
    }

    if (event.kind === "role_change") {
      await writeAudit(event.actor ?? event.waUserId ?? "system", AuditAction.UPDATE, "RoleChange", event.targetWaUserId, {
        action: event.action,
        role: event.role,
        scope: event.scope,
        tenantId: event.tenantId,
        waGroupId: event.waGroupId
      });
      return;
    }
  }
});

export const coreFlagsRepository = {
  resolveFlags: async (input: { tenantId: string; waGroupId?: string; waUserId: string }) => {
    const { user, group } = await resolveScopedUserAndGroup({
      tenantId: input.tenantId,
      waUserId: input.waUserId,
      waGroupId: input.waGroupId
    });
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
    const { user, group } = await resolveScopedUserAndGroup({
      tenantId: input.tenantId,
      waUserId: input.waUserId,
      waGroupId: input.waGroupId
    });
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

export const tasksRepository = createTasksRepository({
  prisma,
  resolveScopedUserAndGroup
});

export const remindersRepository = createRemindersRepository({
  prisma,
  resolveScopedUserAndGroup
});

export const notesRepository = createNotesRepository({
  prisma,
  resolveScopedUserAndGroup
});

export const timersRepository = createTimersRepository({
  prisma,
  resolveScopedUserAndGroup
});

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
  if (!raw) return { isConnected: false, at: null, online: false, ageSeconds: null as number | null };
  const parsed = JSON.parse(raw) as { isConnected: boolean; at: string };
  const ageSeconds = parsed.at ? Math.round((Date.now() - new Date(parsed.at).getTime()) / 1000) : null;
  const online = ageSeconds !== null ? ageSeconds < 30 : false;
  return { ...parsed, ageSeconds, online };
};

export const markWorkerHeartbeat = async (redis: Redis) => {
  await redis.set("worker:heartbeat", JSON.stringify({ ok: true, at: new Date().toISOString() }), "EX", 30);
};

export const getWorkerHeartbeat = async (redis: Redis) => {
  const raw = await redis.get("worker:heartbeat");
  if (!raw) return { ok: false, at: null, online: false, ageSeconds: null as number | null };
  const parsed = JSON.parse(raw) as { ok: boolean; at: string };
  const ageSeconds = parsed.at ? Math.round((Date.now() - new Date(parsed.at).getTime()) / 1000) : null;
  const online = ageSeconds !== null ? ageSeconds < 30 : false;
  return { ...parsed, ageSeconds, online };
};

export const getRecentMessages = (limit: number) =>
  prisma.message.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, body: true, createdAt: true, waUserId: true, waGroupId: true, direction: true } });

export const getReminderById = (id: string) => prisma.reminder.findUnique({ where: { id } });
export const updateReminderStatus = (id: string, status: ReminderStatus) => prisma.reminder.update({ where: { id }, data: { status } });

export const getTimerById = (id: string) => prisma.timer.findUnique({ where: { id } });
export const updateTimerStatus = (id: string, status: TimerStatus) => prisma.timer.update({ where: { id }, data: { status } });

export type ReminderDispatchRecord = Prisma.ReminderGetPayload<{
  include: {
    user: {
      select: {
        phoneNumber: true;
        lidJid: true;
        pnJid: true;
      };
    };
  };
}>;

export type TimerDispatchRecord = Prisma.TimerGetPayload<{
  include: {
    user: {
      select: {
        phoneNumber: true;
        lidJid: true;
        pnJid: true;
      };
    };
  };
}>;

export const getReminderDispatchById = (id: string) =>
  prisma.reminder.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          phoneNumber: true,
          lidJid: true,
          pnJid: true
        }
      }
    }
  });

export const getTimerDispatchById = (id: string) =>
  prisma.timer.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          phoneNumber: true,
          lidJid: true,
          pnJid: true
        }
      }
    }
  });

export type WhatsAppSender = (to: string, text: string) => Promise<{ messageId?: string; raw?: unknown }>;

export const markReminderMessage = async (input: { reminderId: string; messageId?: string }) => {
  await prisma.reminder.update({ where: { id: input.reminderId }, data: { sentMessageId: input.messageId } });
};

export const markTimerMessage = async (input: { timerId: string; messageId?: string }) => {
  await prisma.timer.update({ where: { id: input.timerId }, data: { sentMessageId: input.messageId } });
};

export const createMuteAdapter = (redis: Redis) => ({
  getMuteState: async (input: { tenantId: string; scope: Scope; scopeId: string; waUserId?: string }) => {
    const key = `mute:${input.tenantId}:${input.scope}:${input.scopeId}${input.waUserId ? `:${input.waUserId}` : ""}`;
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
  mute: async (input: { tenantId: string; scope: Scope; scopeId: string; durationMs: number; now: Date; waUserId?: string }) => {
    const key = `mute:${input.tenantId}:${input.scope}:${input.scopeId}${input.waUserId ? `:${input.waUserId}` : ""}`;
    const until = new Date(input.now.getTime() + input.durationMs);
    const ttlSeconds = Math.max(1, Math.round(input.durationMs / 1000));
    await redis.set(key, until.toISOString(), "EX", ttlSeconds);
    return { until };
  },
  unmute: async (input: { tenantId: string; scope: Scope; scopeId: string; waUserId?: string }) => {
    const key = `mute:${input.tenantId}:${input.scope}:${input.scopeId}${input.waUserId ? `:${input.waUserId}` : ""}`;
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

export const consentRepository = {
  getConsent: async (input: { tenantId: string; waUserId: string; termsVersion?: string }) => {
    const user = await findUserForTenant(input.tenantId, input.waUserId);
    if (!user) return null;
    const where: Prisma.UserConsentWhereInput = { tenantId: input.tenantId, userId: user.id };
    if (input.termsVersion) where.termsVersion = input.termsVersion;
    const row = await prisma.userConsent.findFirst({ where, orderBy: { createdAt: "desc" } });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      status: row.status as ConsentStatus,
      termsVersion: row.termsVersion,
      acceptedAt: row.acceptedAt,
      declinedAt: row.declinedAt,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  },
  setConsentStatus: async (input: {
    tenantId: string;
    waUserId: string;
    status: ConsentStatus;
    termsVersion: string;
    source?: string;
    timestamp?: Date;
  }) => {
    const user =
      (await findUserForTenant(input.tenantId, input.waUserId)) ??
      (await prisma.user.create({
        data: { tenantId: input.tenantId, waUserId: input.waUserId, displayName: input.waUserId, role: "member" }
      }));
    const ts = input.timestamp ?? new Date();
    const acceptedAt = input.status === "ACCEPTED" ? ts : null;
    const declinedAt = input.status === "DECLINED" ? ts : null;
    const row = await prisma.userConsent.upsert({
      where: { tenantId_userId_termsVersion: { tenantId: input.tenantId, userId: user.id, termsVersion: input.termsVersion } },
      create: {
        tenantId: input.tenantId,
        userId: user.id,
        status: input.status,
        termsVersion: input.termsVersion,
        source: input.source ?? "wa-gateway",
        acceptedAt,
        declinedAt
      },
      update: {
        status: input.status,
        source: input.source ?? "wa-gateway",
        acceptedAt,
        declinedAt
      }
    });
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      status: row.status as ConsentStatus,
      termsVersion: row.termsVersion,
      acceptedAt: row.acceptedAt,
      declinedAt: row.declinedAt,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
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
    const permissionRole = resolved.canonical.permissionRole ?? user?.permissionRole ?? null;
    const basePermissions = ["task", "reminder", "note", "agenda", "calc", "timer", "status"];
    const adminPermissions = ["admin:flags", "admin:triggers", "admin:status"];
    const effectiveRole = (permissionRole ?? role)?.toLowerCase?.() ?? "member";
    const elevated = ["admin", "root", "owner"].includes(effectiveRole);
    const permissions = elevated ? [...basePermissions, ...adminPermissions] : basePermissions;
    const canonical = resolved.canonical;
    const relationship =
      resolved.relationship && resolved.relationshipReason
        ? { profile: resolved.relationship, reason: resolved.relationshipReason }
        : resolveRelationshipProfile({
            waUserId: canonical.waUserId,
            phoneNumber: canonical.phoneNumber,
            pnJid: canonical.pnJid,
            lidJid: canonical.lidJid,
            aliases: canonical.aliases,
            storedProfile: canonical.relationshipProfile ?? null,
            identityRole: permissionRole ?? role
          });

    if (process.env.NODE_ENV !== "production") {
      const relationshipSource =
        relationship.reason?.startsWith("match:")
          ? "privileged_override"
          : relationship.reason === "stored_profile"
            ? "db"
            : relationship.reason?.startsWith("role:")
              ? "role"
              : "default";
      const permissionRoleSource = resolved.permissionRoleSource ?? (permissionRole ? "db" : "none");
      identityLogger.debug(
        {
          stage: "identityRepository.getIdentity",
          tenantId: input.tenantId,
          waUserId: input.waUserId,
          phoneNumber: canonical.phoneNumber,
          pnJid: canonical.pnJid,
          lidJid: canonical.lidJid,
          relationshipProfile: relationship.profile,
          relationshipReason: relationship.reason,
          relationshipSource,
          permissionRole,
          permissionRoleSource,
          matchedPrivilegedRule: relationship.reason?.startsWith("match:") ?? false,
          updatedFields: resolved.updatedFields,
          created: resolved.created
        },
        "identity resolved"
      );
    }

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
    const privilegedPermissionRole =
      relationship.profile === "creator_root"
        ? "ROOT"
        : relationship.profile === "mother_privileged"
          ? "PRIVILEGED"
          : null;
    const permissionRoleTarget = privilegedPermissionRole ?? targetUser.permissionRole ?? null;

    if (!targetUser.relationshipProfile || toRelationshipProfile(targetUser.relationshipProfile) !== relationship.profile) {
      updates.relationshipProfile = relationship.profile;
    }
    if (permissionRoleTarget && targetUser.permissionRole !== permissionRoleTarget) {
      updates.permissionRole = permissionRoleTarget;
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
      permissionRole: canonical.permissionRole ?? permissionRoleTarget ?? null
    };
  }
};

export const groupAccessRepository = createGroupAccessRepository({
  prisma,
  writeAudit
});

export const botAdminRepository = createBotAdminRepository({
  prisma,
  writeAudit,
  resolveCanonicalUserIdentity,
  findUserForTenant
});

export const createStatusPort = (deps: {
  redis: Redis;
  queue: Queue;
  llmEnabled: boolean;
  llmConfigured: boolean;
}) => ({
  getStatus: async (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => {
    const [dbOk, redisOk, gateway, worker, jobCounts, tasksOpen, remindersScheduled, timersScheduled] = await Promise.all([
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
      deps.queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      tasksRepository.countOpen({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.waUserId }),
      remindersRepository.countScheduled({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.waUserId }),
      timersRepository.countScheduled({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.waUserId })
    ]);

    return {
      gateway: { ok: gateway.isConnected, at: gateway.at, online: gateway.online, ageSeconds: gateway.ageSeconds },
      worker: { ok: worker.ok, at: worker.at, online: worker.online, ageSeconds: worker.ageSeconds },
      db: { ok: dbOk },
      redis: { ok: redisOk },
      llm: { enabled: deps.llmEnabled, ok: deps.llmEnabled ? deps.llmConfigured : false, reason: deps.llmEnabled && !deps.llmConfigured ? "missing-key" : undefined },
      counts: { tasksOpen, remindersScheduled, timersScheduled },
      queue: {
        waiting: jobCounts.waiting ?? 0,
        active: jobCounts.active ?? 0,
        completed: jobCounts.completed ?? 0,
        failed: jobCounts.failed ?? 0,
        delayed: jobCounts.delayed ?? 0
      }
    };
  }
});
