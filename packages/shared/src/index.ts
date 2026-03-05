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
  QUEUE_NAME: z.string().default("reminders"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  LLM_ENABLED: z.coerce.boolean().default(true),
  BOT_TIMEZONE: z.string().default("America/Cuiaba"),
  WA_SESSION_PATH: z.string().default(".wa_auth"),
  ONLY_GROUP_ID: z.string().optional(),
  DEFAULT_TENANT_NAME: z.string().default("Default Tenant"),
  DEFAULT_BOT_NAME: z.string().default("Zappy"),
  ASSISTANT_MODE_DEFAULT: z.enum(["off", "professional", "fun", "mixed"]).default("professional"),
  FUN_MODE_DEFAULT: z.enum(["off", "on"]).default("off")
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
  enabled: z.boolean().default(true),
  value: z.string().default("on"),
  scope: z.enum(["GLOBAL", "TENANT", "GROUP", "USER"]),
  tenantId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  userId: z.string().uuid().optional()
});

export const triggerSchema = z.object({
  name: z.string().min(1),
  pattern: z.string().min(1),
  responseTemplate: z.string().min(1),
  matchType: z.enum(["CONTAINS", "REGEX", "STARTS_WITH"]),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  cooldownSeconds: z.number().int().min(0).default(0),
  scope: z.enum(["GLOBAL", "TENANT", "GROUP", "USER"]).default("GLOBAL"),
  tenantId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  userId: z.string().uuid().optional()
});

export type FeatureFlagInput = z.infer<typeof featureFlagSchema>;
export type TriggerInput = z.infer<typeof triggerSchema>;
