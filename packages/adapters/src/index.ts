import { PrismaClient, Scope, MatchType, AuditAction } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { FeatureFlagInput, TriggerInput } from "@zappy/shared";

export const prisma = new PrismaClient();

export const createRedisConnection = (redisUrl: string) => new IORedis(redisUrl, { maxRetriesPerRequest: null });

export const createQueue = (queueName: string, redisUrl: string) =>
  new Queue(queueName, { connection: createRedisConnection(redisUrl) });

const writeAudit = async (actor: string, action: AuditAction, entity: string, entityId: string, metadata?: unknown) => {
  await prisma.auditLog.create({
    data: {
      actor,
      action,
      entity,
      entityId,
      metadata: metadata as object | undefined
    }
  });
};

const normalizeScope = (scope: FeatureFlagInput["scope"]) => Scope[scope];
const normalizeMatch = (matchType: TriggerInput["matchType"]) => MatchType[matchType];

export const featureFlagRepository = {
  list: () => prisma.featureFlag.findMany({ orderBy: { createdAt: "desc" } }),
  create: async (input: FeatureFlagInput, actor: string) => {
    const created = await prisma.featureFlag.create({
      data: {
        key: input.key,
        description: input.description,
        enabled: input.enabled,
        scope: normalizeScope(input.scope)
      }
    });
    await writeAudit(actor, "CREATE", "FeatureFlag", created.id, created);
    return created;
  },
  update: async (id: string, input: FeatureFlagInput, actor: string) => {
    const updated = await prisma.featureFlag.update({
      where: { id },
      data: {
        key: input.key,
        description: input.description,
        enabled: input.enabled,
        scope: normalizeScope(input.scope)
      }
    });
    await writeAudit(actor, "UPDATE", "FeatureFlag", id, updated);
    return updated;
  },
  remove: async (id: string, actor: string) => {
    await prisma.featureFlag.delete({ where: { id } });
    await writeAudit(actor, "DELETE", "FeatureFlag", id);
  }
};

export const triggerRepository = {
  list: () => prisma.trigger.findMany({ orderBy: { createdAt: "desc" } }),
  create: async (input: TriggerInput, actor: string) => {
    const created = await prisma.trigger.create({
      data: {
        name: input.name,
        pattern: input.pattern,
        matchType: normalizeMatch(input.matchType),
        enabled: input.enabled
      }
    });
    await writeAudit(actor, "CREATE", "Trigger", created.id, created);
    return created;
  },
  update: async (id: string, input: TriggerInput, actor: string) => {
    const updated = await prisma.trigger.update({
      where: { id },
      data: {
        name: input.name,
        pattern: input.pattern,
        matchType: normalizeMatch(input.matchType),
        enabled: input.enabled
      }
    });
    await writeAudit(actor, "UPDATE", "Trigger", id, updated);
    return updated;
  },
  remove: async (id: string, actor: string) => {
    await prisma.trigger.delete({ where: { id } });
    await writeAudit(actor, "DELETE", "Trigger", id);
  }
};

export const auditLogRepository = {
  list: (limit: number) => prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit })
};
