import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";

type HeartbeatPayload = {
  at: string | null;
  online: boolean;
  ageSeconds: number | null;
};

type GatewayHeartbeat = HeartbeatPayload & {
  isConnected: boolean;
};

type WorkerHeartbeat = HeartbeatPayload & {
  ok: boolean;
};

export const markGatewayHeartbeat = async (redis: Redis, isConnected: boolean) => {
  await redis.set("gateway:heartbeat", JSON.stringify({ isConnected, at: new Date().toISOString() }), "EX", 30);
};

export const getGatewayHeartbeat = async (redis: Redis): Promise<GatewayHeartbeat> => {
  const raw = await redis.get("gateway:heartbeat");
  if (!raw) return { isConnected: false, at: null, online: false, ageSeconds: null };
  const parsed = JSON.parse(raw) as { isConnected: boolean; at: string };
  const ageSeconds = parsed.at ? Math.round((Date.now() - new Date(parsed.at).getTime()) / 1000) : null;
  const online = ageSeconds !== null ? ageSeconds < 30 : false;
  return { ...parsed, ageSeconds, online };
};

export const markWorkerHeartbeat = async (redis: Redis) => {
  await redis.set("worker:heartbeat", JSON.stringify({ ok: true, at: new Date().toISOString() }), "EX", 30);
};

export const getWorkerHeartbeat = async (redis: Redis): Promise<WorkerHeartbeat> => {
  const raw = await redis.get("worker:heartbeat");
  if (!raw) return { ok: false, at: null, online: false, ageSeconds: null };
  const parsed = JSON.parse(raw) as { ok: boolean; at: string };
  const ageSeconds = parsed.at ? Math.round((Date.now() - new Date(parsed.at).getTime()) / 1000) : null;
  const online = ageSeconds !== null ? ageSeconds < 30 : false;
  return { ...parsed, ageSeconds, online };
};

interface StatusRepositoryDeps {
  redis: Redis;
  queue: Queue;
  llmEnabled: boolean;
  llmConfigured: boolean;
  prisma: PrismaClient;
  tasksRepository: {
    countOpen: (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => Promise<number>;
  };
  remindersRepository: {
    countScheduled: (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => Promise<number>;
  };
  timersRepository: {
    countScheduled: (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => Promise<number>;
  };
}

export const createStatusPort = (deps: StatusRepositoryDeps) => ({
  getStatus: async (input: { tenantId: string; waGroupId?: string; waUserId?: string }) => {
    const [dbOk, redisOk, gateway, worker, jobCounts, tasksOpen, remindersScheduled, timersScheduled] = await Promise.all([
      deps.prisma
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
      deps.tasksRepository.countOpen({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.waUserId }),
      deps.remindersRepository.countScheduled({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.waUserId }),
      deps.timersRepository.countScheduled({ tenantId: input.tenantId, waGroupId: input.waGroupId, waUserId: input.waUserId })
    ]);

    return {
      gateway: { ok: gateway.isConnected, at: gateway.at, online: gateway.online, ageSeconds: gateway.ageSeconds },
      worker: { ok: worker.ok, at: worker.at, online: worker.online, ageSeconds: worker.ageSeconds },
      db: { ok: dbOk },
      redis: { ok: redisOk },
      llm: {
        enabled: deps.llmEnabled,
        ok: deps.llmEnabled ? deps.llmConfigured : false,
        reason: deps.llmEnabled && !deps.llmConfigured ? "missing-key" : undefined
      },
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
