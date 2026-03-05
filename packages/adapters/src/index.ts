import {
  AuditAction,
  MatchType,
  PrismaClient,
  ReminderStatus,
  Scope,
  TaskStatus,
  type MessageDirection,
  type Prisma
} from "@prisma/client";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import OpenAI from "openai";
import { LlmError, type ConversationMessage, type InboundMessageEvent, type LlmErrorReason, type LlmPort, type ReminderCreateInput } from "@zappy/core";
import type { FeatureFlagInput, TriggerInput } from "@zappy/shared";

export const prisma = new PrismaClient();
export const createRedisConnection = (redisUrl: string) => new Redis(redisUrl, { maxRetriesPerRequest: null });
export const createQueue = (queueName: string, redisUrl: string) =>
  new Queue(queueName, { connection: createRedisConnection(redisUrl) as unknown as any });

const scopeOrder: Scope[] = [Scope.USER, Scope.GROUP, Scope.TENANT, Scope.GLOBAL];

const writeAudit = async (actor: string, action: AuditAction, entity: string, entityId: string, metadata?: unknown) => {
  await prisma.auditLog.create({ data: { actor, action, entity, entityId, metadata: metadata as Prisma.JsonObject | undefined } });
};

export const ensureTenantContext = async (input: {
  waGroupId?: string;
  waUserId: string;
  defaultTenantName: string;
  onlyGroupId?: string;
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

  const user =
    (await prisma.user.findUnique({ where: { waUserId: input.waUserId } })) ??
    (await prisma.user.create({ data: { tenantId: tenant.id, waUserId: input.waUserId, displayName: input.waUserId } }));

  return { tenant, group, user };
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
    const user = await prisma.user.findUnique({ where: { waUserId: input.waUserId } });
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
    const user = await prisma.user.findUnique({ where: { waUserId: input.waUserId } });
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
  addTask: async (input: { tenantId: string; title: string; createdByWaUserId: string }) => {
    const row = await prisma.task.create({ data: { tenantId: input.tenantId, type: "TASK", payload: { title: input.title, createdByWaUserId: input.createdByWaUserId }, status: TaskStatus.PENDING } });
    return { id: row.id, title: input.title };
  },
  listTasks: async (input: { tenantId: string }) => {
    const rows = await prisma.task.findMany({ where: { tenantId: input.tenantId, type: "TASK" }, orderBy: { createdAt: "desc" }, take: 20 });
    return rows.map((row) => ({ id: row.id, title: String((row.payload as Prisma.JsonObject).title ?? "untitled"), done: row.status === TaskStatus.DONE }));
  },
  markDone: async (input: { tenantId: string; taskId: string }) => {
    const row = await prisma.task.findFirst({ where: { id: input.taskId, tenantId: input.tenantId, type: "TASK" } });
    if (!row) return false;
    await prisma.task.update({ where: { id: row.id }, data: { status: TaskStatus.DONE } });
    return true;
  }
};

export const remindersRepository = {
  createReminder: async (input: ReminderCreateInput) => {
    const user = await prisma.user.findUnique({ where: { waUserId: input.waUserId } });
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
  }
};

export const messagesRepository = {
  getRecentMessages: async (input: { tenantId: string; waGroupId?: string; waUserId: string; limit: number }): Promise<ConversationMessage[]> => {
    const rows = await prisma.message.findMany({
      where: { tenantId: input.tenantId, waUserId: input.waUserId, waGroupId: input.waGroupId },
      orderBy: { createdAt: "desc" },
      take: input.limit
    });
    return rows
      .reverse()
      .map((row) => ({ role: row.direction === "INBOUND" ? "user" : "assistant", content: row.body }));
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
    const job = await queue.add("send-reminder", { reminderId }, { jobId: reminderId, delay });
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

export const getRecentMessages = (limit: number) =>
  prisma.message.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, body: true, createdAt: true, waUserId: true, waGroupId: true, direction: true } });

export const getReminderById = (id: string) => prisma.reminder.findUnique({ where: { id } });
export const updateReminderStatus = (id: string, status: ReminderStatus) => prisma.reminder.update({ where: { id }, data: { status } });

export type WhatsAppSender = (to: string, text: string) => Promise<{ messageId?: string; raw?: unknown }>;

export const markReminderMessage = async (input: { reminderId: string; messageId?: string }) => {
  await prisma.reminder.update({ where: { id: input.reminderId }, data: { sentMessageId: input.messageId } });
};
