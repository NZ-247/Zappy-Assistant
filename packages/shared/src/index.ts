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
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  LLM_ENABLED: z.coerce.boolean().default(true),
  LLM_MEMORY_MESSAGES: z.coerce.number().int().min(0).default(10),
  LLM_PERSONA: z.string().default("secretary_default"),
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

export type LogCategory = "SYSTEM" | "WA-IN" | "WA-OUT" | "AI" | "HTTP" | "QUEUE" | "DB" | "WARN" | "ERROR";

export const createLogger = (name: string, options?: LoggerOptions) =>
  pino({
    name,
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
    ...options
  });

export const withCategory = (category: LogCategory, payload?: Record<string, unknown>) => ({
  category,
  ...(payload ?? {})
});

export const printStartupBanner = (
  logger: { info: (obj: unknown, msg?: string) => void },
  input: {
    app: string;
    environment: string;
    timezone?: string;
    llmEnabled?: boolean;
    model?: string;
    adminApiUrl?: string;
    adminUiUrl?: string;
    queueName?: string;
    extras?: Record<string, string | number | boolean | null | undefined>;
  }
) => {
  if (process.env.NODE_ENV === "production") return;
  const lines = [
    `🟢 ${input.app} — Zappy Assistant`,
    `Env: ${input.environment}`,
    input.timezone ? `Timezone: ${input.timezone}` : null,
    `LLM: ${input.llmEnabled ? "ENABLED" : "DISABLED"}${input.model ? ` (${input.model})` : ""}`,
    input.adminApiUrl ? `Admin API: ${input.adminApiUrl}` : null,
    input.adminUiUrl ? `Admin UI: ${input.adminUiUrl}` : null,
    input.queueName ? `Queue: ${input.queueName}` : null
  ]
    .concat(
      Object.entries(input.extras ?? {})
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}: ${v}`)
    )
    .filter(Boolean);

  const banner = ["======================================", ...lines, "======================================"].join("\\n");
  logger.info(withCategory("SYSTEM", { banner, ...input }), banner);
};

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
