import {
  adminGovernanceRepository,
  adminJobsRepository,
  createMetricsRecorder,
  createQueue,
  createRedisConnection,
  governancePort
} from "@zappy/adapters";
import { createLogger, loadEnv } from "@zappy/shared";

export const createAdminApiRuntime = () => {
  const env = loadEnv();
  const logger = createLogger("admin-api");
  const redis = createRedisConnection(env.REDIS_URL);
  const metrics = createMetricsRecorder(redis);
  const queue = createQueue(env.QUEUE_NAME, env.REDIS_URL);
  return {
    env,
    logger,
    redis,
    metrics,
    queue,
    governancePort,
    adminGovernanceRepository,
    adminJobsRepository
  };
};

export type AdminApiRuntime = ReturnType<typeof createAdminApiRuntime>;
