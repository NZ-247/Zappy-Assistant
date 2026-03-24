import { prisma } from "@zappy/adapters";
import { withCategory } from "@zappy/shared";
import type { AssistantApiRuntime } from "./runtime.js";

export const checkDatabaseHealth = async (): Promise<boolean> =>
  prisma
    .$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false);

export const checkRedisHealth = async (runtime: Pick<AssistantApiRuntime, "redis">): Promise<boolean> =>
  runtime.redis
    .ping()
    .then(() => true)
    .catch(() => false);

export const reportStartupStatus = async (runtime: Pick<AssistantApiRuntime, "logger" | "redis">): Promise<void> => {
  const dbOk = await checkDatabaseHealth();
  const redisOk = await checkRedisHealth(runtime);
  runtime.logger.info(withCategory("DB", { status: dbOk ? "OK" : "FAIL" }), `DB ${dbOk ? "OK" : "FAIL"}`);
  runtime.logger.info(withCategory("SYSTEM", { target: "Redis", status: redisOk ? "OK" : "FAIL" }), `Redis ${redisOk ? "OK" : "FAIL"}`);
};
