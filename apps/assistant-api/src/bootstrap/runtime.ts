import { createQueue, createRedisConnection, createMetricsRecorder, governancePort } from "@zappy/adapters";
import { createLogger, loadEnv } from "@zappy/shared";

export const createAssistantApiRuntime = () => {
  const env = loadEnv();
  const logger = createLogger("assistant-api");
  const redis = createRedisConnection(env.REDIS_URL);
  const metrics = createMetricsRecorder(redis);
  const queue = createQueue(env.QUEUE_NAME, env.REDIS_URL);
  return { env, logger, redis, metrics, queue, governancePort };
};

export type AssistantApiRuntime = ReturnType<typeof createAssistantApiRuntime>;
