import pino, { type LoggerOptions } from "pino";
import { Writable } from "node:stream";

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
  | "ERROR"
  | "COMMAND_TRACE";

type PrettyContext = {
  timezone?: string;
  profile: "dev" | "prod";
  silenceNoise: boolean;
  verboseStacks: boolean;
  verboseFields: boolean;
  colorize: boolean;
};

type RuntimeMode = "dev" | "prod" | "debug";
type LogFormat = "pretty" | "json";
type LogLevel = NonNullable<LoggerOptions["level"]>;

type ResolvedLogConfig = {
  runtimeMode: RuntimeMode;
  format: LogFormat;
  level: LogLevel;
  prettyMode: "dev" | "prod";
  verboseFields: boolean;
  silenceNoise: boolean;
  verboseStacks: boolean;
};

const ANSI = {
  reset: "\u001B[0m",
  dim: "\u001B[2m",
  bold: "\u001B[1m",
  colors: {
    gray: "\u001B[90m",
    cyan: "\u001B[36m",
    brightCyan: "\u001B[96m",
    blue: "\u001B[34m",
    brightBlue: "\u001B[94m",
    green: "\u001B[32m",
    brightGreen: "\u001B[92m",
    yellow: "\u001B[33m",
    brightYellow: "\u001B[93m",
    magenta: "\u001B[35m",
    brightMagenta: "\u001B[95m",
    red: "\u001B[31m",
    white: "\u001B[37m"
  }
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
const LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
const CORE_DETAIL_FIELDS = [
  "status",
  "route",
  "method",
  "code",
  "jobId",
  "queue",
  "model",
  "phase",
  "commandName",
  "resultSummary",
  "action",
  "waMessageId",
  "inboundWaMessageId",
  "executionId",
  "traceId",
  "commandExecutionId",
  "responseActionId"
] as const;
const VERBOSE_DETAIL_FIELDS = [
  "tenantId",
  "waGroupId",
  "waUserId",
  "phoneNumber",
  "scope",
  "permissionRole",
  "relationshipProfile",
  "target",
  "module",
  "name",
  "signal",
  "statusCode",
  "retryCount",
  "latencyMs",
  "durationMs"
] as const;

const categoryColor = (category?: string): string => {
  switch (category) {
    case "SYSTEM":
      return ANSI.colors.brightCyan;
    case "AUTH":
      return ANSI.colors.magenta;
    case "WA-IN":
      return ANSI.colors.brightGreen;
    case "WA-OUT":
      return ANSI.colors.brightBlue;
    case "AI":
      return ANSI.colors.magenta;
    case "HTTP":
      return ANSI.colors.cyan;
    case "QUEUE":
      return ANSI.colors.brightYellow;
    case "DB":
      return ANSI.colors.blue;
    case "WARN":
      return ANSI.colors.yellow;
    case "ERROR":
      return ANSI.colors.red;
    case "COMMAND_TRACE":
      return ANSI.colors.brightMagenta;
    default:
      return ANSI.colors.gray;
  }
};

const parseColorEnv = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  const bool = parseBooleanEnv(normalized);
  if (bool !== undefined) return bool;
  if (/^\d+$/.test(normalized)) return Number(normalized) > 0;
  return undefined;
};

const resolveColorize = (): boolean => {
  const noColorRaw = process.env.NO_COLOR;
  if (noColorRaw !== undefined) {
    const noColor = parseColorEnv(noColorRaw);
    if (noColor !== false) return false;
  }
  const explicit = parseBooleanEnv(process.env.LOG_COLORIZE);
  if (explicit !== undefined) return explicit;
  const forced = parseColorEnv(process.env.FORCE_COLOR);
  if (forced !== undefined) return forced;
  return process.stdout.isTTY;
};

const parseBooleanEnv = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
};

const parseRuntimeMode = (value: string | undefined): RuntimeMode | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "dev" || normalized === "prod" || normalized === "debug") return normalized;
  return undefined;
};

const parseLogFormat = (value: string | undefined): LogFormat | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "pretty" || normalized === "json") return normalized;
  return undefined;
};

const parsePrettyMode = (value: string | undefined): "dev" | "prod" | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "dev" || normalized === "prod") return normalized;
  return undefined;
};

const parseLogLevel = (value: string | undefined): LogLevel | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!LOG_LEVELS.has(normalized)) return undefined;
  return normalized as LogLevel;
};

const resolveLogConfig = (): ResolvedLogConfig => {
  const runtimeMode = parseRuntimeMode(process.env.ZAPPY_RUNTIME_MODE) ?? (process.env.NODE_ENV === "production" ? "prod" : "dev");
  const debugRaw = (process.env.DEBUG ?? "").toLowerCase();
  const debugTrace = debugRaw.includes("trace");
  const debugStack = debugRaw.includes("stack");

  const runtimeDefaults =
    runtimeMode === "debug"
      ? ({
          format: "json",
          level: "debug",
          prettyMode: "dev",
          verboseFields: true,
          silenceNoise: false,
          verboseStacks: true
        } satisfies Omit<ResolvedLogConfig, "runtimeMode">)
      : runtimeMode === "prod"
        ? ({
            format: "pretty",
            level: "info",
            prettyMode: "prod",
            verboseFields: false,
            silenceNoise: true,
            verboseStacks: false
          } satisfies Omit<ResolvedLogConfig, "runtimeMode">)
        : ({
            format: "pretty",
            level: "debug",
            prettyMode: "dev",
            verboseFields: true,
            silenceNoise: true,
            verboseStacks: false
          } satisfies Omit<ResolvedLogConfig, "runtimeMode">);

  const legacyPretty = process.env.LOG_FORMAT ? undefined : parseBooleanEnv(process.env.PRETTY_LOGS);
  const format = parseLogFormat(process.env.LOG_FORMAT) ?? (legacyPretty === undefined ? runtimeDefaults.format : legacyPretty ? "pretty" : "json");

  return {
    runtimeMode,
    format,
    level: parseLogLevel(process.env.LOG_LEVEL) ?? runtimeDefaults.level,
    prettyMode: parsePrettyMode(process.env.LOG_PRETTY_MODE) ?? runtimeDefaults.prettyMode,
    verboseFields: parseBooleanEnv(process.env.LOG_VERBOSE_FIELDS) ?? runtimeDefaults.verboseFields,
    silenceNoise: debugTrace ? false : runtimeDefaults.silenceNoise,
    verboseStacks: debugStack || runtimeDefaults.verboseStacks
  };
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

const toDisplayValue = (value: unknown, maxLen = 64): string | null => {
  if (value === undefined) return null;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value !== "string") return null;
  const compact = truncate(value.replace(/\s+/g, " ").trim(), maxLen);
  if (!compact) return null;
  return /\s/.test(compact) ? `"${compact}"` : compact;
};

const pickDetailParts = (obj: any, verboseFields: boolean): string[] => {
  const keys = [...CORE_DETAIL_FIELDS, ...(verboseFields ? VERBOSE_DETAIL_FIELDS : [])];
  const uniqueKeys = new Set<string>(keys);
  const details: string[] = [];
  for (const key of uniqueKeys) {
    const displayValue = toDisplayValue(obj[key], verboseFields ? 96 : 64);
    if (displayValue === null) continue;
    details.push(`${key}=${displayValue}`);
  }
  return details;
};

const resolveSourceLabel = (obj: any): string => {
  const source = obj?.name ?? obj?.service ?? obj?.app ?? obj?.module ?? "app";
  if (typeof source !== "string") return "app";
  const normalized = source.trim();
  return normalized || "app";
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

const formatWaLine = (obj: any, ctx: PrettyContext): string => {
  const time = formatLocalTime(obj.time ?? obj.timestamp ?? Date.now(), ctx.timezone);
  const category = obj.category ?? "WA-IN";
  const source = resolveSourceLabel(obj);
  const scope = obj.scope === "group" ? "GROUP" : "DIRECT";
  const role = obj.permissionRole ?? obj.role ?? "";
  const profile = obj.relationshipProfile ?? "";
  const number = normalizeNumber(obj.phoneNumber ?? obj.waUserId) ?? "-";
  const identity = [role, profile, number].filter(Boolean).join(" ");
  const traceParts = [
    obj.waMessageId ? `msg=${obj.waMessageId}` : null,
    obj.inboundWaMessageId ? `in=${obj.inboundWaMessageId}` : null,
    obj.executionId ? `exec=${obj.executionId}` : null,
    obj.traceId && obj.traceId !== obj.executionId ? `trace=${obj.traceId}` : null,
    obj.responseActionId ? `resp=${obj.responseActionId}` : null
  ]
    .filter(Boolean)
    .join(" ");
  const trace = traceParts ? ` ${traceParts}` : "";
  const action = obj.action ? ` action=${obj.action}` : "";
  const previewSource = obj.textPreview ?? obj.text ?? obj.msg ?? "";
  const previewLimit = ctx.profile === "prod" ? 56 : 80;
  const preview = previewSource ? ` -> "${truncate(String(previewSource).replace(/\s+/g, " ").trim(), previewLimit)}"` : "";
  return `[${time}] [${category}] [${source}] [${scope}] ${identity}${trace}${action}${preview}`.replace(/\s+/g, " ").trim();
};

const formatErrorBlock = (obj: any, tz?: string, levelLabel?: string, verboseStacks?: boolean, colorize?: boolean): string => {
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
  const title = `[${time}] [${cat}] ${levelLabel ?? ""}`.trim();
  const lines = [
    colorize ? `${ANSI.bold}${title}${ANSI.reset}` : title,
    `source: ${src}`,
    msg ? `message: ${msg}` : null,
    hint ? `hint: ${hint}` : null,
    err?.message ? `error: ${err.message}` : null
  ]
    .filter(Boolean)
    .join("\n");
  const stack =
    verboseStacks && err?.stack
      ? (() => {
          const stackText = String(err.stack)
            .split("\n")
            .slice(0, 12)
            .join("\n");
          return `\nstack:\n${colorize ? `${ANSI.dim}${stackText}${ANSI.reset}` : stackText}`;
        })()
      : "";
  return `-----\n${lines}${stack}\n-----`;
};

const formatErrorSingleLine = (obj: any, category: string, ctx: PrettyContext): string => {
  const time = formatLocalTime(obj.time ?? obj.timestamp ?? Date.now(), ctx.timezone);
  const source = resolveSourceLabel(obj);
  const msg = String(obj.msg ?? obj.message ?? "").trim();
  const err = obj.err ?? obj.error;
  const errMsg = toDisplayValue(err?.message ?? err, 80);
  const hint =
    obj.category === "QUEUE"
      ? "hint=check_queue_redis_payload"
      : obj.category === "AI"
        ? "hint=check_llm_key_or_network"
        : obj.category === "DB"
          ? "hint=check_database_url_or_db"
          : null;
  const details = [
    errMsg ? `error=${errMsg}` : null,
    hint,
    ...pickDetailParts(obj, ctx.verboseFields)
  ]
    .filter(Boolean)
    .join(" ");
  const headline = msg || String(err?.message ?? `${category.toLowerCase()} event`);
  return `[${time}] [${category}] [${source}] ${headline}${details ? ` ${details}` : ""}`;
};

const formatGenericLine = (obj: any, category: string, ctx: PrettyContext): string => {
  const time = formatLocalTime(obj.time ?? obj.timestamp ?? Date.now(), ctx.timezone);
  const source = resolveSourceLabel(obj);
  const msg = String(obj.msg ?? obj.message ?? "").trim();
  const details = pickDetailParts(obj, ctx.verboseFields);
  return `[${time}] [${category}] [${source}] ${msg}${details.length ? ` ${details.join(" ")}` : ""}`.trim();
};

const createPrettyStream = (ctx: PrettyContext) => {
  const dedupSeen = dedupe();
  return new Writable({
    write(chunk, _enc, cb) {
      try {
        const parsed = JSON.parse(chunk.toString());
        const obj = sanitizeBaileysLog(parsed);
        if (ctx.silenceNoise && isBaileysNoise(obj) && process.env.DEBUG !== "trace") return cb();
        const level = Number(obj.level ?? 30);
        const category = obj.category ?? (level >= 50 ? "ERROR" : level === 40 ? "WARN" : "SYSTEM");
        const key =
          String(category).startsWith("WA-") && (obj.waMessageId || obj.inboundWaMessageId)
            ? `${category}:${obj.waMessageId ?? obj.inboundWaMessageId}:${obj.action ?? obj.status ?? obj.responseActionId ?? obj.phase ?? ""}`
            : null;
        if (dedupSeen(key)) return cb();

        const color = categoryColor(category);
        let line: string;
        if (category === "WA-IN" || category === "WA-OUT") {
          line = formatWaLine(obj, ctx);
        } else if ((category === "ERROR" || level >= 50) && ctx.profile === "dev") {
          line = formatErrorBlock(obj, ctx.timezone, "ERROR", ctx.verboseStacks, ctx.colorize);
        } else if ((category === "WARN" || level === 40) && ctx.profile === "dev") {
          line = formatErrorBlock(obj, ctx.timezone, "WARN", ctx.verboseStacks, ctx.colorize);
        } else if (category === "ERROR" || category === "WARN" || level >= 40) {
          line = formatErrorSingleLine(obj, category, ctx);
        } else {
          line = formatGenericLine(obj, category, ctx);
        }
        if (ctx.colorize) {
          process.stdout.write(`${color}${line}${ANSI.reset}\n`);
        } else {
          process.stdout.write(`${line}\n`);
        }
      } catch {
        process.stdout.write(chunk);
      }
      cb();
    }
  });
};

export const createLogger = (name: string, options?: LoggerOptions) => {
  const resolved = resolveLogConfig();
  const baseOptions: LoggerOptions = {
    name,
    level: resolved.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    ...options
  };
  if (resolved.format !== "pretty") return pino(baseOptions);

  const pretty = createPrettyStream({
    timezone: process.env.BOT_TIMEZONE,
    profile: resolved.prettyMode,
    silenceNoise: resolved.silenceNoise,
    verboseStacks: resolved.verboseStacks,
    verboseFields: resolved.verboseFields,
    colorize: resolveColorize()
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
  if (process.env.ZAPPY_SKIP_SERVICE_BANNER === "true" || process.env.ZAPPY_SKIP_SERVICE_BANNER === "1") return;
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
    `Redis: ${input.redisStatus ?? "PENDING"} | DB: ${input.dbStatus ?? "PENDING"} | Worker: ${input.workerStatus ?? "PENDING"} | LLM: ${
      input.llmStatus ?? (input.llmEnabled ? "PENDING" : "OFF")
    }`
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
