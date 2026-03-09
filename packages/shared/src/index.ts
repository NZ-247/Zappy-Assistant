import dotenv from "dotenv";
import pino, { type LoggerOptions } from "pino";
import { Writable } from "node:stream";
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
  FUN_MODE_DEFAULT: z.enum(["off", "on"]).default("off"),
  CONSENT_TERMS_VERSION: z.string().default("2026-03"),
  CONSENT_LINK: z.string().default("https://services.net.br/politics"),
  CONSENT_SOURCE: z.string().default("wa-gateway")
});

export type AppEnv = z.infer<typeof envSchema>;

export const loadEnv = (): AppEnv => {
  dotenv.config();
  return envSchema.parse(process.env);
};

export type LogCategory =
  | "SYSTEM"
  | "AUTH"
  | "WA-IN"
  | "WA-OUT"
  | "AI"
  | "HTTP"
  | "QUEUE"
  | "DB"
  | "WARN"
  | "ERROR";

type PrettyContext = {
  timezone?: string;
  silenceNoise?: boolean;
  verboseStacks?: boolean;
};

const ANSI = {
  reset: "\u001B[0m",
  dim: "\u001B[2m",
  bold: "\u001B[1m",
  colors: {
    gray: "\u001B[90m",
    cyan: "\u001B[36m",
    blue: "\u001B[34m",
    green: "\u001B[32m",
    yellow: "\u001B[33m",
    magenta: "\u001B[35m",
    red: "\u001B[31m",
    white: "\u001B[37m"
  }
};

const categoryColor = (category?: string): string => {
  switch (category) {
    case "SYSTEM":
      return ANSI.colors.cyan;
    case "AUTH":
      return ANSI.colors.magenta;
    case "WA-IN":
      return ANSI.colors.green;
    case "WA-OUT":
      return ANSI.colors.blue;
    case "AI":
      return ANSI.colors.magenta;
    case "HTTP":
      return ANSI.colors.cyan;
    case "QUEUE":
      return ANSI.colors.yellow;
    case "DB":
      return ANSI.colors.white;
    case "WARN":
      return ANSI.colors.yellow;
    case "ERROR":
      return ANSI.colors.red;
    default:
      return ANSI.colors.gray;
  }
};

const formatLocalTime = (input: string | number | undefined, timezone?: string): string => {
  const date = input ? new Date(input) : new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  return fmt.format(date);
};

const normalizeNumber = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const num = value.replace(/\D/g, "");
  return num || undefined;
};

const truncate = (text: string, max = 90): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const isBaileysNoise = (obj: any): boolean => {
  const level = Number(obj?.level ?? 30);
  if (level >= 40) return false;

  const text = String(obj?.msg ?? obj?.message ?? obj?.event ?? "");
  const tag = String(obj?.tag ?? "");
  const lowerText = text.toLowerCase();
  const lowerTag = tag.toLowerCase();

  const noisyTokens = [
    "regular_low",
    "retry receipt",
    "recv receipt",
    "sync response",
    "processing sync",
    "resync",
    "app state sync",
    "connection state",
    "signal store",
    "sessionentry",
    "closing session",
    "opening session",
    "session sync",
    "sync timeout",
    "pre-key"
  ];

  if (noisyTokens.some((token) => lowerText.includes(token) || lowerTag.includes(token))) return true;

  const hasSessionDump =
    lowerText.includes("session") &&
    (obj.session !== undefined || obj.sessions !== undefined || obj.creds !== undefined || obj.credsUpdate !== undefined);

  return hasSessionDump;
};

const sanitizeBaileysLog = (obj: any) => {
  if (!obj || typeof obj !== "object" || process.env.DEBUG === "trace") return obj;
  const heavyKeys = [
    "session",
    "sessions",
    "creds",
    "credsUpdate",
    "signalIdentities",
    "preKeys",
    "appStateSyncKey",
    "node"
  ];
  const copy: Record<string, unknown> = { ...obj };
  for (const key of heavyKeys) {
    if (copy[key] !== undefined) {
      copy[key] = "[hidden]";
    }
  }
  return copy;
};

const dedupe = () => {
  const seen = new Map<string, number>();
  const limit = 500;
  return (key: string | null): boolean => {
    if (!key) return false;
    if (seen.has(key)) return true;
    seen.set(key, Date.now());
    if (seen.size > limit) {
      const first = seen.keys().next().value as string | undefined;
      if (first) seen.delete(first);
    }
    return false;
  };
};

const formatWaLine = (obj: any, tz?: string): string => {
  const time = formatLocalTime(obj.time ?? obj.timestamp ?? Date.now(), tz);
  const scope = obj.scope === "group" ? "GROUP" : "DIRECT";
  const role = obj.permissionRole ?? obj.role ?? "";
  const profile = obj.relationshipProfile ?? "";
  const number = normalizeNumber(obj.phoneNumber ?? obj.waUserId) ?? "-";
  const action = obj.action ? ` action=${obj.action}` : "";
  const previewSource = obj.textPreview ?? obj.text ?? obj.msg ?? "";
  const preview = previewSource ? ` -> "${truncate(String(previewSource).replace(/\s+/g, " ").trim(), 80)}"` : "";
  return `[${time}] [${obj.category}] [${scope}] ${role || ""} ${profile || ""} ${number}${action}${preview}`.replace(/\s+/g, " ").trim();
};

const formatErrorBlock = (obj: any, tz?: string, levelLabel?: string, verboseStacks?: boolean): string => {
  const time = formatLocalTime(obj.time ?? obj.timestamp ?? Date.now(), tz);
  const cat = obj.category ?? (obj.level >= 50 ? "ERROR" : "WARN");
  const src = obj.name ?? obj.module ?? "app";
  const msg = obj.msg ?? obj.message ?? "";
  const err = obj.err ?? obj.error;
  const hint =
    obj.category === "QUEUE"
      ? "Hint: check Redis/queue connectivity and job payload."
      : obj.category === "AI"
        ? "Hint: verify OPENAI_API_KEY/LLM_ENABLED and network connectivity."
        : obj.category === "DB"
          ? "Hint: verify DATABASE_URL and DB availability."
          : undefined;
  const lines = [
    `${categoryColor(cat)}${ANSI.bold}[${time}] [${cat}] ${levelLabel ?? ""}${ANSI.reset}`,
    `source: ${src}`,
    msg ? `message: ${msg}` : null,
    hint ? `hint: ${hint}` : null,
    err?.message ? `error: ${err.message}` : null
  ]
    .filter(Boolean)
    .join("\n");
  const stack =
    verboseStacks && err?.stack
      ? `\nstack:\n${ANSI.dim}${String(err.stack)
          .split("\n")
          .slice(0, 12)
          .join("\n")}${ANSI.reset}`
      : "";
  return `-----\n${lines}${stack}\n-----`;
};

const formatGenericLine = (obj: any, tz?: string): string => {
  const time = formatLocalTime(obj.time ?? obj.timestamp ?? Date.now(), tz);
  const cat = obj.category ?? "SYSTEM";
  const msg = obj.msg ?? obj.message ?? "";
  const detailFields = ["status", "route", "method", "code", "jobId", "queue", "model"]
    .map((key) => (obj[key] !== undefined ? `${key}=${obj[key]}` : null))
    .filter(Boolean);
  const details = detailFields.length ? ` ${detailFields.join(" ")}` : "";
  return `[${time}] [${cat}] ${msg}${details}`.trim();
};

const createPrettyStream = (ctx: PrettyContext) => {
  const dedupSeen = dedupe();
  const silenceNoise = ctx.silenceNoise ?? true;
  const verboseStacks = ctx.verboseStacks ?? false;
  return new Writable({
    write(chunk, _enc, cb) {
      try {
        const parsed = JSON.parse(chunk.toString());
        const obj = sanitizeBaileysLog(parsed);
        if (silenceNoise && isBaileysNoise(obj) && process.env.DEBUG !== "trace") return cb();
        const key = obj.category?.startsWith("WA-") && obj.waMessageId ? `${obj.category}:${obj.waMessageId}` : null;
        if (dedupSeen(key)) return cb();

        const level = Number(obj.level ?? 30);
        const cat = obj.category ?? (level >= 50 ? "ERROR" : level === 40 ? "WARN" : undefined);
        const color = categoryColor(cat);
        let line: string;
        if (cat === "WA-IN" || cat === "WA-OUT") {
          line = formatWaLine(obj, ctx.timezone);
        } else if (cat === "ERROR" || level >= 50) {
          line = formatErrorBlock(obj, ctx.timezone, "ERROR", verboseStacks);
        } else if (cat === "WARN" || level === 40) {
          line = formatErrorBlock(obj, ctx.timezone, "WARN", verboseStacks);
        } else {
          line = formatGenericLine(obj, ctx.timezone);
        }
        process.stdout.write(`${color}${line}${ANSI.reset}\n`);
      } catch {
        process.stdout.write(chunk);
      }
      cb();
    }
  });
};

export const createLogger = (name: string, options?: LoggerOptions) => {
  const baseOptions: LoggerOptions = {
    name,
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
    timestamp: pino.stdTimeFunctions.isoTime,
    ...options
  };
  const prettyEnabled = process.env.NODE_ENV !== "production" && process.env.PRETTY_LOGS !== "false";
  if (!prettyEnabled) return pino(baseOptions);

  const pretty = createPrettyStream({
    timezone: process.env.BOT_TIMEZONE,
    silenceNoise: process.env.DEBUG !== "trace",
    verboseStacks: process.env.DEBUG?.includes("stack") ?? false
  });
  return pino(baseOptions, pretty);
};

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
    redisStatus?: "OK" | "FAIL" | "PENDING";
    dbStatus?: "OK" | "FAIL" | "PENDING";
    workerStatus?: "OK" | "FAIL" | "PENDING";
    llmStatus?: "OK" | "FAIL" | "PENDING";
    waSessionPath?: string;
    extras?: Record<string, string | number | boolean | null | undefined>;
  }
) => {
  if (process.env.NODE_ENV === "production" && process.env.STARTUP_BANNER !== "true") return;
  const lines = [
    "==============================================",
    `🟢 ${input.app} — Zappy Assistant`,
    `Env: ${input.environment}`,
    input.timezone ? `Timezone: ${input.timezone}` : null,
    `LLM: ${input.llmEnabled ? "ENABLED" : "DISABLED"}${input.model ? ` (${input.model})` : ""}`,
    input.queueName ? `Queue: ${input.queueName}` : null,
    input.adminApiUrl ? `Admin API: ${input.adminApiUrl}` : null,
    input.adminUiUrl ? `Admin UI: ${input.adminUiUrl}` : null,
    input.waSessionPath ? `WA Session Path: ${input.waSessionPath}` : null,
    `Redis: ${input.redisStatus ?? "PENDING"} | DB: ${input.dbStatus ?? "PENDING"} | Worker: ${input.workerStatus ?? "PENDING"} | LLM: ${input.llmStatus ?? (input.llmEnabled ? "PENDING" : "OFF")}`
  ]
    .concat(
      Object.entries(input.extras ?? {})
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}: ${v}`)
    )
    .filter(Boolean);

  const banner = [...lines, "=============================================="].join("\n");
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
