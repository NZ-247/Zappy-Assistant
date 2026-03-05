import dotenv from "dotenv";
import pino, { type LoggerOptions } from "pino";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ADMIN_API_PORT: z.coerce.number().default(3333),
  ADMIN_UI_PORT: z.coerce.number().default(8080),
  ADMIN_API_TOKEN: z.string().min(1),
  QUEUE_NAME: z.string().default("reminders")
});

export type AppEnv = z.infer<typeof envSchema>;

export const loadEnv = (): AppEnv => {
  dotenv.config();
  return envSchema.parse(process.env);
};

export const createLogger = (name: string, options?: LoggerOptions) =>
  pino({
    name,
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    ...options
  });

export const idSchema = z.object({ id: z.string().uuid() });

export const featureFlagSchema = z.object({
  key: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
  scope: z.enum(["GLOBAL", "TENANT", "GROUP", "USER"])
});

export const triggerSchema = z.object({
  name: z.string().min(1),
  pattern: z.string().min(1),
  matchType: z.enum(["EXACT", "CONTAINS", "REGEX"]),
  enabled: z.boolean().default(true)
});

export type FeatureFlagInput = z.infer<typeof featureFlagSchema>;
export type TriggerInput = z.infer<typeof triggerSchema>;
