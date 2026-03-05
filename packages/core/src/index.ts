import {
  addDurationToNow,
  DEFAULT_REMINDER_TIME,
  formatDateTimeInZone,
  isTimeLike,
  normalizeTimezone,
  parseDateTimeWithZone,
  parseDurationInput
} from "./time.js";

export type Scope = "GLOBAL" | "TENANT" | "GROUP" | "USER";
export type MatchType = "CONTAINS" | "REGEX" | "STARTS_WITH";

export interface InboundMessageEvent {
  tenantId: string;
  waGroupId?: string;
  waUserId: string;
  text: string;
  waMessageId: string;
  timestamp: Date;
  isGroup: boolean;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type LlmErrorReason = "rate_limit" | "insufficient_quota" | "timeout" | "network" | "unknown";

export class LlmError extends Error {
  readonly reason: LlmErrorReason;
  readonly status?: number;
  readonly code?: string;

  constructor(reason: LlmErrorReason, message?: string, meta?: { status?: number; code?: string; cause?: unknown }) {
    super(message ?? reason);
    this.name = "LlmError";
    this.reason = reason;
    this.status = meta?.status;
    this.code = meta?.code;
    if (meta?.cause !== undefined) {
      // Preserve root cause when available for downstream logging/inspection.
      (this as Error & { cause?: unknown }).cause = meta.cause;
    }
    Object.setPrototypeOf(this, LlmError.prototype);
  }
}

export interface FlagValue {
  key: string;
  value: string;
  scope: Scope;
}

export interface TriggerRule {
  id: string;
  name: string;
  pattern: string;
  responseTemplate: string;
  enabled: boolean;
  matchType: MatchType;
  priority: number;
  cooldownSeconds: number;
  scope: Scope;
}

export interface ReminderCreateInput {
  tenantId: string;
  waUserId: string;
  waGroupId?: string;
  message: string;
  remindAt: Date;
}

export interface ReminderRecord {
  id: string;
  status: "SCHEDULED" | "SENT" | "FAILED" | "CANCELED";
}

export interface ReplyAction {
  type: "reply";
  text: string;
}

export interface EnqueueReminderAction {
  type: "enqueue_reminder";
  reminderId: string;
  remindAt: Date;
}

export interface NoopAction {
  type: "noop";
}

export type OrchestratorAction = ReplyAction | EnqueueReminderAction | NoopAction;

export interface FlagsRepositoryPort {
  resolveFlags(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<Record<string, string>>;
}

export interface TriggersRepositoryPort {
  findActiveByScope(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<TriggerRule[]>;
}

export interface TasksRepositoryPort {
  addTask(input: { tenantId: string; title: string; createdByWaUserId: string }): Promise<{ id: string; title: string }>;
  listTasks(input: { tenantId: string }): Promise<Array<{ id: string; title: string; done: boolean }>>;
  markDone(input: { tenantId: string; taskId: string }): Promise<boolean>;
}

export interface RemindersRepositoryPort {
  createReminder(input: ReminderCreateInput): Promise<ReminderRecord>;
}

export interface MessagesRepositoryPort {
  getRecentMessages(input: { tenantId: string; waGroupId?: string; waUserId: string; limit: number }): Promise<ConversationMessage[]>;
}

export interface CooldownPort {
  canFire(key: string, ttlSeconds: number): Promise<boolean>;
}

export interface RateLimitPort {
  allow(key: string, max: number, windowSeconds: number): Promise<boolean>;
}

export interface QueuePort {
  enqueueReminder(reminderId: string, runAt: Date): Promise<{ jobId: string }>;
}

export interface LlmPort {
  chat(input: { system: string; messages: ConversationMessage[] }): Promise<string>;
}

export interface PromptPort {
  resolvePrompt(input: { tenantId: string; waGroupId?: string }): Promise<string | null>;
}

export interface ClockPort {
  now(): Date;
}

export interface LoggerPort {
  warn(obj: unknown, msg?: string, ...args: unknown[]): void;
}

export interface CorePorts {
  flagsRepository: FlagsRepositoryPort;
  triggersRepository: TriggersRepositoryPort;
  tasksRepository: TasksRepositoryPort;
  remindersRepository: RemindersRepositoryPort;
  messagesRepository: MessagesRepositoryPort;
  cooldown: CooldownPort;
  rateLimit: RateLimitPort;
  queue: QueuePort;
  llm: LlmPort;
  prompt: PromptPort;
  clock?: ClockPort;
  botName?: string;
  defaultAssistantMode?: "off" | "professional" | "fun" | "mixed";
  defaultFunMode?: "off" | "on";
  llmEnabled?: boolean;
  logger?: LoggerPort;
  timezone?: string;
  defaultReminderTime?: string;
}

const renderTemplate = (template: string, vars: Record<string, string>): string => {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
};

const isMatch = (text: string, trigger: TriggerRule): boolean => {
  const source = text.toLowerCase();
  const pattern = trigger.pattern.toLowerCase();
  if (trigger.matchType === "CONTAINS") return source.includes(pattern);
  if (trigger.matchType === "STARTS_WITH") return source.startsWith(pattern);
  try {
    return new RegExp(trigger.pattern, "i").test(text);
  } catch {
    return false;
  }
};

const parseReminder = (
  text: string,
  options: { now: Date; timezone: string; defaultReminderTime: string }
): { remindAt: Date; message: string; pretty: string } | null => {
  const inMatch = text.match(/^\/reminder\s+in\s+(\S+)\s+(.+)$/i);
  if (inMatch) {
    const duration = parseDurationInput(inMatch[1]);
    const message = inMatch[2]?.trim();
    if (!duration || !message) return null;
    const { date, pretty } = addDurationToNow({ durationMs: duration.milliseconds, timezone: options.timezone, now: options.now });
    return { remindAt: date, message, pretty };
  }

  const atMatch = text.match(/^\/reminder\s+at\s+(.+)$/i);
  if (!atMatch) return null;

  const tokens = atMatch[1].trim().split(/\s+/);
  if (tokens.length < 2) return null;

  const dateToken = tokens.shift()!;
  let timeToken: string | undefined;
  if (tokens.length >= 1 && isTimeLike(tokens[0])) {
    timeToken = tokens.shift();
  }
  const message = tokens.join(" ").trim();
  if (!message) return null;

  const parsed = parseDateTimeWithZone({
    dateToken,
    timeToken,
    timezone: options.timezone,
    now: options.now,
    defaultTime: options.defaultReminderTime
  });
  if (!parsed) return null;

  return { remindAt: parsed.date, message, pretty: parsed.pretty };
};

export class Orchestrator {
  private readonly ports: CorePorts;
  private readonly llmUnavailableText =
    "No momento estou sem acesso ao assistente inteligente. Você ainda pode usar /help, /task e /reminder.";

  constructor(ports: CorePorts) {
    this.ports = ports;
  }

  async handleInboundMessage(event: InboundMessageEvent): Promise<OrchestratorAction[]> {
    const allowed = await this.ports.rateLimit.allow(`rate:${event.waUserId}`, 20, 60);
    if (!allowed) return [{ type: "reply", text: "Rate limit exceeded. Please wait a bit." }];

    const flags = await this.ports.flagsRepository.resolveFlags({
      tenantId: event.tenantId,
      waGroupId: event.waGroupId,
      waUserId: event.waUserId
    });

    const timezone = normalizeTimezone(this.ports.timezone);
    const defaultReminderTime = this.ports.defaultReminderTime ?? DEFAULT_REMINDER_TIME;
    const now = this.ports.clock?.now() ?? new Date();
    const nowFormatted = formatDateTimeInZone(now, timezone);

    const assistantMode = (flags.assistant_mode ?? this.ports.defaultAssistantMode ?? "professional") as string;
    const funMode = (flags.fun_mode ?? this.ports.defaultFunMode ?? "off") as string;
    const bot = this.ports.botName ?? "Zappy";

    const triggers = await this.ports.triggersRepository.findActiveByScope({
      tenantId: event.tenantId,
      waGroupId: event.waGroupId,
      waUserId: event.waUserId
    });

    for (const trigger of triggers) {
      if (!trigger.enabled) continue;
      if (!isMatch(event.text, trigger)) continue;
      if (trigger.name.toLowerCase().includes("fun") && funMode !== "on") continue;

      const scopePart = event.waGroupId ?? event.waUserId;
      const key = `cooldown:${trigger.id}:${scopePart}`;
      const canFire = await this.ports.cooldown.canFire(key, Math.max(1, trigger.cooldownSeconds));
      if (!canFire) continue;

      return [
        {
          type: "reply",
          text: renderTemplate(trigger.responseTemplate, {
            user: event.waUserId,
            group: event.waGroupId ?? "direct",
            bot,
            date: nowFormatted
          })
        }
      ];
    }

    const cmd = event.text.trim();
    if (cmd === "/help") {
      return [
        {
          type: "reply",
          text: [
            "Commands:",
            "/help",
            "/task add <title>",
            "/task list",
            "/task done <id>",
            "/reminder in <duration> <message> (e.g. 10m, 1h30m)",
            "/reminder at <DD-MM[-YYYY]> [HH:MM] <message>"
          ].join("\n")
        }
      ];
    }

    if (cmd.startsWith("/task add ")) {
      const title = cmd.replace("/task add ", "").trim();
      if (!title) return [{ type: "reply", text: "Task title is required." }];
      const task = await this.ports.tasksRepository.addTask({ tenantId: event.tenantId, title, createdByWaUserId: event.waUserId });
      return [{ type: "reply", text: `Task created: ${task.id} - ${task.title}` }];
    }

    if (cmd === "/task list") {
      const tasks = await this.ports.tasksRepository.listTasks({ tenantId: event.tenantId });
      if (tasks.length === 0) return [{ type: "reply", text: "No tasks yet." }];
      return [{ type: "reply", text: tasks.map((t) => `${t.done ? "✅" : "⬜"} ${t.id}: ${t.title}`).join("\n") }];
    }

    if (cmd.startsWith("/task done ")) {
      const taskId = cmd.replace("/task done ", "").trim();
      const done = await this.ports.tasksRepository.markDone({ tenantId: event.tenantId, taskId });
      return [{ type: "reply", text: done ? `Task ${taskId} marked done.` : `Task ${taskId} not found.` }];
    }

    if (cmd.startsWith("/reminder ")) {
      const parsed = parseReminder(cmd, { now, timezone, defaultReminderTime });
      if (!parsed) return [{ type: "reply", text: "Invalid reminder format." }];
      const reminder = await this.ports.remindersRepository.createReminder({
        tenantId: event.tenantId,
        waUserId: event.waUserId,
        waGroupId: event.waGroupId,
        message: parsed.message,
        remindAt: parsed.remindAt
      });
      return [
        { type: "reply", text: `Reminder ${reminder.id} set for ${parsed.pretty} (${timezone})` },
        { type: "enqueue_reminder", reminderId: reminder.id, remindAt: parsed.remindAt }
      ];
    }

    if (assistantMode !== "off") {
      if (this.ports.llmEnabled === false) {
        return [{ type: "reply", text: this.llmUnavailableText }];
      }

      const messages = await this.ports.messagesRepository.getRecentMessages({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId,
        limit: 10
      });
      const system =
        (await this.ports.prompt.resolvePrompt({ tenantId: event.tenantId, waGroupId: event.waGroupId })) ??
        "You are a concise WhatsApp assistant.";
      try {
        const llmText = await this.ports.llm.chat({
          system,
          messages: [...messages, { role: "user", content: event.text }]
        });
        return [{ type: "reply", text: llmText }];
      } catch (error) {
        const payload = {
          tenantId: event.tenantId,
          waUserId: event.waUserId,
          waGroupId: event.waGroupId,
          messageId: event.waMessageId,
          error,
          llmReason: error instanceof LlmError ? error.reason : "unknown"
        };
        if (this.ports.logger?.warn) {
          this.ports.logger.warn(payload, "llm fallback failed");
        } else {
          console.warn("llm fallback failed", payload);
        }
        return [{ type: "reply", text: this.llmUnavailableText }];
      }
    }

    return [{ type: "noop" }];
  }
}
