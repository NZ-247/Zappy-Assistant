type LoggerLike = {
  warn?: (obj: unknown, msg?: string, ...args: unknown[]) => void;
  child?: (...args: unknown[]) => LoggerLike;
  [key: string]: unknown;
};

type DecryptSeverity = "transient" | "persistent_suspect";

interface DecryptIssueClassification {
  code: "failed_to_decrypt_message" | "bad_mac" | "key_reuse_or_missing" | "no_matching_sessions";
  severity: DecryptSeverity;
}

interface DecryptIssueEntry {
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastLoggedAt: number;
  suppressedSinceLastLog: number;
}

const DECRYPT_PATTERNS: Array<{ pattern: RegExp; issue: DecryptIssueClassification }> = [
  {
    pattern: /failed to decrypt message/i,
    issue: { code: "failed_to_decrypt_message", severity: "transient" }
  },
  {
    pattern: /bad mac/i,
    issue: { code: "bad_mac", severity: "transient" }
  },
  {
    pattern: /key used already or never filled/i,
    issue: { code: "key_reuse_or_missing", severity: "persistent_suspect" }
  },
  {
    pattern: /no matching sessions found/i,
    issue: { code: "no_matching_sessions", severity: "persistent_suspect" }
  }
];

const toShortText = (value: string, max = 200): string => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
};

const toErrorMessage = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
  }
  if (typeof value === "string" && value.trim()) return value;
  return undefined;
};

const extractLogText = (args: unknown[]): { text: string; remoteJid?: string } => {
  const objectArg = args.find((arg) => typeof arg === "object" && arg !== null) as Record<string, unknown> | undefined;
  const stringArgs = args.filter((arg): arg is string => typeof arg === "string" && arg.trim().length > 0);

  const objectTextParts = [
    toErrorMessage(objectArg?.msg),
    toErrorMessage(objectArg?.message),
    toErrorMessage((objectArg?.err as { message?: unknown } | undefined)?.message),
    toErrorMessage(objectArg?.error)
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));

  const joined = [...stringArgs, ...objectTextParts].join(" | ").trim();
  const text = joined.length > 0 ? joined : "unknown baileys warning";
  const remoteJidRaw =
    (objectArg?.remoteJid as string | undefined) ??
    (objectArg?.jid as string | undefined) ??
    ((objectArg?.key as { remoteJid?: string } | undefined)?.remoteJid as string | undefined);
  const remoteJid = typeof remoteJidRaw === "string" && remoteJidRaw.trim().length > 0 ? remoteJidRaw : undefined;

  return { text, remoteJid };
};

const classifyDecryptIssue = (text: string): DecryptIssueClassification | null => {
  for (const item of DECRYPT_PATTERNS) {
    if (item.pattern.test(text)) return item.issue;
  }
  return null;
};

const nextLogWindowMs = (severity: DecryptSeverity): number => {
  return severity === "persistent_suspect" ? 20_000 : 60_000;
};

const nextLogRepeat = (severity: DecryptSeverity): number => {
  return severity === "persistent_suspect" ? 3 : 10;
};

const recommendationFor = (severity: DecryptSeverity, count: number): string => {
  if (severity === "transient") return "monitor_only";
  if (count >= 10) return "consider_controlled_repair_or_session_reset";
  return "monitor_and_prepare_repair_if_repeats";
};

const registerDecryptIssue = (
  bucket: Map<string, DecryptIssueEntry>,
  signature: string,
  severity: DecryptSeverity
): { shouldLog: boolean; entry: DecryptIssueEntry; suppressedBeforeLog: number } => {
  const now = Date.now();
  const current =
    bucket.get(signature) ??
    ({
      count: 0,
      firstSeenAt: now,
      lastSeenAt: now,
      lastLoggedAt: 0,
      suppressedSinceLastLog: 0
    } as DecryptIssueEntry);

  current.count += 1;
  current.lastSeenAt = now;

  const enoughByCount = current.count % nextLogRepeat(severity) === 0;
  const enoughByTime = now - current.lastLoggedAt >= nextLogWindowMs(severity);
  const shouldLog = current.count === 1 || enoughByCount || enoughByTime;
  const suppressedBeforeLog = current.suppressedSinceLastLog;
  if (shouldLog) {
    current.lastLoggedAt = now;
    current.suppressedSinceLastLog = 0;
  } else {
    current.suppressedSinceLastLog += 1;
  }

  bucket.set(signature, current);
  if (bucket.size > 250) {
    const firstKey = bucket.keys().next().value as string | undefined;
    if (firstKey) bucket.delete(firstKey);
  }

  return { shouldLog, entry: current, suppressedBeforeLog };
};

interface CreateBaileysRuntimeLoggerInput {
  baseLogger: LoggerLike;
  appLogger: LoggerLike;
  withCategory: (category: "AUTH", payload?: Record<string, unknown>) => unknown;
}

export const createBaileysRuntimeLogger = (input: CreateBaileysRuntimeLoggerInput): LoggerLike => {
  const decryptIssues = new Map<string, DecryptIssueEntry>();

  const interceptDecryptIssue = (target: LoggerLike, level: string, args: unknown[]): boolean => {
    if (!["warn", "error", "fatal"].includes(level)) return false;
    const { text, remoteJid } = extractLogText(args);
    const issue = classifyDecryptIssue(text);
    if (!issue) return false;

    const signature = `${issue.code}:${remoteJid ?? "unknown"}`;
    const tracked = registerDecryptIssue(decryptIssues, signature, issue.severity);
    if (!tracked.shouldLog) return true;

    const windowSeconds = Math.max(0, Math.round((tracked.entry.lastSeenAt - tracked.entry.firstSeenAt) / 1000));
    try {
      input.appLogger.warn?.(
        input.withCategory("AUTH", {
          status: "WA_DECRYPT_ISSUE",
          issueCode: issue.code,
          severity: issue.severity,
          signature,
          occurrences: tracked.entry.count,
          suppressedSinceLastLog: tracked.suppressedBeforeLog,
          windowSeconds,
          firstSeenAt: new Date(tracked.entry.firstSeenAt).toISOString(),
          lastSeenAt: new Date(tracked.entry.lastSeenAt).toISOString(),
          remoteJid,
          recommendation: recommendationFor(issue.severity, tracked.entry.count),
          sample: toShortText(text)
        }),
        "baileys decrypt issue"
      );
    } catch {
      // Logging must never fail the runtime path.
    }
    return true;
  };

  const wrap = (target: LoggerLike): LoggerLike =>
    new Proxy(target, {
      get(obj, prop, receiver) {
        if (prop === "child") {
          return (...args: unknown[]) => {
            const child =
              typeof obj.child === "function" ? ((obj.child as (...childArgs: unknown[]) => LoggerLike).apply(obj, args) ?? obj) : obj;
            return wrap(child);
          };
        }

        if (typeof prop === "string" && ["warn", "error", "fatal"].includes(prop)) {
          return (...args: unknown[]) => {
            if (interceptDecryptIssue(obj, prop, args)) return;
            const method = obj[prop] as ((...methodArgs: unknown[]) => unknown) | undefined;
            if (typeof method !== "function") return;
            try {
              return method.apply(obj, args);
            } catch (error) {
              try {
                input.appLogger.warn?.(
                  {
                    category: "WARN",
                    module: "baileys-runtime-logger",
                    status: "BAILEYS_LOGGER_FORWARD_FAILED",
                    level: prop,
                    err: error
                  },
                  "baileys logger forwarding failed"
                );
              } catch {
                // Never throw from logger wrapper.
              }
            }
          };
        }

        const value = Reflect.get(obj as object, prop, receiver);
        if (typeof value === "function") return value.bind(obj);
        return value;
      },
      set(obj, prop, value) {
        (obj as Record<string | symbol, unknown>)[prop] = value;
        return true;
      }
    });

  return wrap(input.baseLogger);
};
