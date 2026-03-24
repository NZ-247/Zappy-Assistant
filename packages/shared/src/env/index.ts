import dotenv from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ADMIN_API_PORT: z.coerce.number().default(3333),
  ADMIN_UI_PORT: z.coerce.number().default(8080),
  ADMIN_API_TOKEN: z.string().min(1),
  WA_GATEWAY_INTERNAL_PORT: z.coerce.number().default(3334),
  WA_GATEWAY_INTERNAL_BASE_URL: z.string().url().default("http://localhost:3334"),
  WA_GATEWAY_INTERNAL_TOKEN: z.string().min(1).default("change-me-internal"),
  QUEUE_NAME: z.string().default("reminders"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  LLM_ENABLED: z.coerce.boolean().default(true),
  LLM_MEMORY_MESSAGES: z.coerce.number().int().min(0).default(10),
  LLM_PERSONA: z.string().default("secretary_default"),
  BOT_TIMEZONE: z.string().default("America/Cuiaba"),
  BOT_PREFIX: z.string().default("/"),
  WA_SESSION_PATH: z.string().default(".wa_auth"),
  ONLY_GROUP_ID: z.string().optional(),
  DEFAULT_TENANT_NAME: z.string().default("Default Tenant"),
  DEFAULT_BOT_NAME: z.string().default("Zappy"),
  ASSISTANT_MODE_DEFAULT: z.enum(["off", "professional", "fun", "mixed"]).default("professional"),
  FUN_MODE_DEFAULT: z.enum(["off", "on"]).default("off"),
  CONSENT_TERMS_VERSION: z.string().default("2026-03"),
  CONSENT_LINK: z.string().default("https://services.net.br/politicas"),
  CONSENT_SOURCE: z.string().default("wa-gateway")
});

export type AppEnv = z.infer<typeof envSchema>;

export const loadEnv = (): AppEnv => {
  dotenv.config();
  return envSchema.parse(process.env);
};
