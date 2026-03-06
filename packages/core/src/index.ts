import {
  addDurationToNow,
  DEFAULT_REMINDER_TIME,
  formatDateTimeInZone,
  getDayRange,
  isTimeLike,
  normalizeTimezone,
  parseDateTimeWithZone,
  parseDurationInput
} from "./time.js";
import { Parser } from "expr-eval";

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
  remindAt?: Date;
  message?: string;
}

export interface NoteRecord {
  id: string;
  publicId: string;
  text: string;
  createdAt: Date;
  scope: Scope;
}

export type TimerStatus = "SCHEDULED" | "FIRED" | "FAILED" | "CANCELED";

export interface TimerCreateInput {
  tenantId: string;
  waUserId: string;
  waGroupId?: string;
  fireAt: Date;
  durationMs: number;
  label?: string;
}

export interface TimerRecord {
  id: string;
  status: TimerStatus;
  fireAt?: Date;
}

export interface TaskListItem {
  id: string;
  title: string;
  done: boolean;
  runAt?: Date | null;
}

export interface StatusSnapshot {
  gateway: { ok: boolean; at?: string | null };
  worker: { ok: boolean; at?: string | null };
  db: { ok: boolean };
  redis: { ok: boolean };
  llm: { enabled: boolean; ok: boolean; reason?: string };
  counts: { tasksOpen: number; remindersScheduled: number; timersScheduled: number };
  queue?: { waiting?: number; active?: number; delayed?: number };
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

export interface EnqueueTimerAction {
  type: "enqueue_timer";
  timerId: string;
  fireAt: Date;
}

export interface NoopAction {
  type: "noop";
}

export type OrchestratorAction = ReplyAction | EnqueueReminderAction | EnqueueTimerAction | NoopAction;

export interface FlagsRepositoryPort {
  resolveFlags(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<Record<string, string>>;
}

export interface TriggersRepositoryPort {
  findActiveByScope(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<TriggerRule[]>;
}

export interface TasksRepositoryPort {
  addTask(input: {
    tenantId: string;
    title: string;
    createdByWaUserId: string;
    waGroupId?: string;
    runAt?: Date | null;
  }): Promise<{ id: string; title: string }>;
  listTasks(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<TaskListItem[]>;
  listTasksForDay(input: { tenantId: string; waGroupId?: string; waUserId?: string; dayStart: Date; dayEnd: Date }): Promise<TaskListItem[]>;
  markDone(input: { tenantId: string; taskId: string; waGroupId?: string; waUserId?: string }): Promise<boolean>;
  countOpen(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<number>;
}

export interface RemindersRepositoryPort {
  createReminder(input: ReminderCreateInput): Promise<ReminderRecord>;
  listForDay(input: { tenantId: string; waGroupId?: string; waUserId: string; dayStart: Date; dayEnd: Date }): Promise<ReminderRecord[]>;
  countScheduled(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<number>;
}

export interface NotesRepositoryPort {
  addNote(input: { tenantId: string; waGroupId?: string; waUserId: string; text: string; scope: Scope }): Promise<NoteRecord>;
  listNotes(input: { tenantId: string; waGroupId?: string; waUserId: string; scope: Scope; limit?: number }): Promise<NoteRecord[]>;
  removeNote(input: { tenantId: string; waGroupId?: string; waUserId: string; publicId: string }): Promise<boolean>;
}

export interface TimersRepositoryPort {
  createTimer(input: TimerCreateInput): Promise<TimerRecord>;
  getTimerById(id: string): Promise<TimerRecord | null>;
  countScheduled(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<number>;
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
  enqueueTimer(timerId: string, runAt: Date): Promise<{ jobId: string }>;
}

export interface LlmPort {
  chat(input: { system: string; messages: ConversationMessage[] }): Promise<string>;
}

export interface PromptPort {
  resolvePrompt(input: { tenantId: string; waGroupId?: string }): Promise<string | null>;
}

export interface MutePort {
  getMuteState(input: { tenantId: string; scope: Scope; scopeId: string }): Promise<{ until: Date } | null>;
  mute(input: { tenantId: string; scope: Scope; scopeId: string; durationMs: number; now: Date }): Promise<{ until: Date }>;
  unmute(input: { tenantId: string; scope: Scope; scopeId: string }): Promise<void>;
}

export interface IdentityPort {
  getIdentity(input: { tenantId: string; waUserId: string; waGroupId?: string }): Promise<{ displayName: string; role: string; permissions: string[]; groupName?: string }>;
}

export interface StatusPort {
  getStatus(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<StatusSnapshot>;
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
  notesRepository?: NotesRepositoryPort;
  timersRepository?: TimersRepositoryPort;
  messagesRepository: MessagesRepositoryPort;
  prompt: PromptPort;
  cooldown: CooldownPort;
  rateLimit: RateLimitPort;
  queue: QueuePort;
  llm: LlmPort;
  mute?: MutePort;
  identity?: IdentityPort;
  status?: StatusPort;
  clock?: ClockPort;
  logger?: LoggerPort;
  botName?: string;
  defaultAssistantMode?: "off" | "professional" | "fun" | "mixed";
  defaultFunMode?: "off" | "on";
  llmEnabled?: boolean;
  timezone?: string;
  defaultReminderTime?: string;
  baseSystemPrompt?: string;
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

const truncate = (text: string, max = 60): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const evaluateExpression = (expression: string): number => {
  const parser = new Parser({ operators: { logical: false, comparison: true }, allowMemberAccess: false });
  const result = parser.evaluate(expression);
  if (typeof result !== "number" || Number.isNaN(result) || !Number.isFinite(result)) throw new Error("Invalid expression result");
  return result;
};

const buildHelpText = () =>
  [
    "Commands:",
    "/help",
    "/task add <title>",
    "/task list",
    "/task done <id>",
    "/note add <text>",
    "/note list",
    "/note rm <id>",
    "/agenda",
    "/calc <expression>",
    "/timer <duration>",
    "/mute <duration>|off",
    "/whoami",
    "/status",
    "/reminder in <duration> <message> (e.g. 10m, 1h30m)",
    "/reminder at <DD-MM[-YYYY]> [HH:MM] <message>"
  ].join("\n");

const formatAgenda = (input: {
  dateLabel: string;
  timezone: string;
  tasks: TaskListItem[];
  reminders: ReminderRecord[];
}) => {
  const lines: string[] = [
    `📅 Agenda ${input.dateLabel} (${input.timezone})`
  ];
  lines.push("\nTarefas:");
  if (input.tasks.length === 0) lines.push("- Nenhuma tarefa para hoje.");
  else
    lines.push(
      ...input.tasks.map((t) => {
        const timePart = t.runAt ? ` @ ${formatDateTimeInZone(t.runAt, input.timezone)}` : "";
        return `${t.done ? "✅" : "⬜"} ${t.id}: ${t.title}${timePart}`;
      })
    );
  lines.push("\nLembretes:");
  if (input.reminders.length === 0) lines.push("- Nenhum lembrete para hoje.");
  else
    lines.push(
      ...input.reminders.map((r) => {
        const timePart = r.remindAt ? formatDateTimeInZone(r.remindAt, input.timezone) : "";
        return `⏰ ${r.id ?? ""} ${timePart} - ${r.message ?? "(sem mensagem)"}`;
      })
    );
  return lines.join("\n");
};

export class Orchestrator {
  private readonly ports: CorePorts;
  private readonly llmUnavailableText =
    "No momento estou sem acesso ao assistente inteligente. Você ainda pode usar /help, /task e /reminder.";

  constructor(ports: CorePorts) {
    this.ports = ports;
  }

  private getScope(event: InboundMessageEvent): { scope: Scope; scopeId: string } {
    return event.waGroupId ? { scope: "GROUP", scopeId: event.waGroupId } : { scope: "USER", scopeId: event.waUserId };
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
    const { scope, scopeId } = this.getScope(event);

    const muteInfo = this.ports.mute
      ? await this.ports.mute.getMuteState({ tenantId: event.tenantId, scope, scopeId })
      : null;
    const isMuted = Boolean(muteInfo && muteInfo.until.getTime() > now.getTime());

    const triggers = !isMuted
      ? await this.ports.triggersRepository.findActiveByScope({
          tenantId: event.tenantId,
          waGroupId: event.waGroupId,
          waUserId: event.waUserId
        })
      : [];

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
    const lower = cmd.toLowerCase();

    // Commands (always available even when muted)
    if (lower === "/help") {
      return [{ type: "reply", text: buildHelpText() }];
    }

    if (lower.startsWith("/task add ")) {
      const title = cmd.replace(/^(\/task add)\s+/i, "").trim();
      if (!title) return [{ type: "reply", text: "Task title is required." }];
      const task = await this.ports.tasksRepository.addTask({
        tenantId: event.tenantId,
        title,
        createdByWaUserId: event.waUserId,
        waGroupId: event.waGroupId
      });
      return [{ type: "reply", text: `Task created: ${task.id} - ${task.title}` }];
    }

    if (lower === "/task list") {
      const tasks = await this.ports.tasksRepository.listTasks({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId
      });
      if (tasks.length === 0) return [{ type: "reply", text: "No tasks yet." }];
      return [{ type: "reply", text: tasks.map((t) => `${t.done ? "✅" : "⬜"} ${t.id}: ${t.title}`).join("\n") }];
    }

    if (lower.startsWith("/task done ")) {
      const taskId = cmd.replace(/^(\/task done)\s+/i, "").trim();
      const done = await this.ports.tasksRepository.markDone({
        tenantId: event.tenantId,
        taskId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId
      });
      return [{ type: "reply", text: done ? `Task ${taskId} marked done.` : `Task ${taskId} not found.` }];
    }

    if (lower.startsWith("/note add ")) {
      if (!this.ports.notesRepository) return [{ type: "reply", text: "Notes module is not available." }];
      const text = cmd.replace(/^(\/note add)\s+/i, "").trim();
      if (!text) return [{ type: "reply", text: "Note text is required." }];
      const note = await this.ports.notesRepository.addNote({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId,
        text,
        scope
      });
      return [{ type: "reply", text: `Nota ${note.publicId} salva.` }];
    }

    if (lower === "/note list") {
      if (!this.ports.notesRepository) return [{ type: "reply", text: "Notes module is not available." }];
      const notes = await this.ports.notesRepository.listNotes({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId,
        scope,
        limit: 10
      });
      if (notes.length === 0) return [{ type: "reply", text: "Nenhuma nota ainda." }];
      const lines = notes.map((n) => `${n.publicId} · ${truncate(n.text, 50)}`);
      return [{ type: "reply", text: lines.join("\n") }];
    }

    if (lower.startsWith("/note rm ")) {
      if (!this.ports.notesRepository) return [{ type: "reply", text: "Notes module is not available." }];
      const publicId = cmd.replace(/^(\/note rm)\s+/i, "").trim().toUpperCase();
      if (!publicId) return [{ type: "reply", text: "Informe o ID da nota (ex: N001)." }];
      const removed = await this.ports.notesRepository.removeNote({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId,
        publicId
      });
      return [{ type: "reply", text: removed ? `Nota ${publicId} removida.` : `Nota ${publicId} não encontrada.` }];
    }

    if (lower === "/agenda") {
      const range = getDayRange({ date: now, timezone });
      const tasks = await this.ports.tasksRepository.listTasksForDay({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId,
        dayStart: range.start,
        dayEnd: range.end
      });
      const reminders = await this.ports.remindersRepository.listForDay({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId,
        dayStart: range.start,
        dayEnd: range.end
      });
      return [{ type: "reply", text: formatAgenda({ dateLabel: range.label, timezone, tasks, reminders }) }];
    }

    if (lower.startsWith("/calc ")) {
      const expression = cmd.replace(/^(\/calc)\s+/i, "").trim();
      if (!expression) return [{ type: "reply", text: "Forneça uma expressão (ex: 5+10*3)." }];
      try {
        const result = evaluateExpression(expression);
        return [{ type: "reply", text: `${expression} = ${result}` }];
      } catch (error) {
        return [{ type: "reply", text: `Expressão inválida: ${(error as Error).message}` }];
      }
    }

    if (lower.startsWith("/timer ")) {
      if (!this.ports.timersRepository) return [{ type: "reply", text: "Timer module is not available." }];
      const durationToken = cmd.replace(/^(\/timer)\s+/i, "").trim();
      const duration = parseDurationInput(durationToken);
      if (!duration) return [{ type: "reply", text: "Formato de duração inválido. Use algo como 10m ou 1h." }];
      const { date, pretty } = addDurationToNow({ durationMs: duration.milliseconds, timezone, now });
      const timer = await this.ports.timersRepository.createTimer({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId,
        fireAt: date,
        durationMs: duration.milliseconds,
        label: duration.pretty
      });
      return [
        { type: "reply", text: `Timer ${timer.id} definido para ${pretty} (${timezone}).` },
        { type: "enqueue_timer", timerId: timer.id, fireAt: date }
      ];
    }

    if (lower.startsWith("/mute")) {
      if (!this.ports.mute) return [{ type: "reply", text: "Mute control is not available." }];
      const arg = cmd.replace(/^\/mute\s*/i, "").trim();
      if (arg.toLowerCase() === "off") {
        await this.ports.mute.unmute({ tenantId: event.tenantId, scope, scopeId });
        return [{ type: "reply", text: "Silêncio desativado." }];
      }
      const duration = parseDurationInput(arg);
      if (!duration) return [{ type: "reply", text: "Informe a duração (ex: 30m, 2h)." }];
      const muted = await this.ports.mute.mute({ tenantId: event.tenantId, scope, scopeId, durationMs: duration.milliseconds, now });
      const untilPretty = formatDateTimeInZone(muted.until, timezone);
      return [{ type: "reply", text: `🤫 Silenciado até ${untilPretty}.` }];
    }

    if (lower === "/whoami") {
      if (!this.ports.identity) {
        return [{ type: "reply", text: `Você é ${event.waUserId}. Permissões básicas para comandos.` }];
      }
      const identity = await this.ports.identity.getIdentity({
        tenantId: event.tenantId,
        waUserId: event.waUserId,
        waGroupId: event.waGroupId
      });
      const lines = [
        `Usuário: ${identity.displayName ?? event.waUserId}`,
        `Role: ${identity.role}`,
        `Permissões: ${identity.permissions.join(", ") || "nenhuma"}`
      ];
      if (identity.groupName) lines.push(`Grupo: ${identity.groupName}`);
      return [{ type: "reply", text: lines.join("\n") }];
    }

    if (lower === "/status") {
      if (!this.ports.status) return [{ type: "reply", text: "Status não disponível." }];
      const status = await this.ports.status.getStatus({ tenantId: event.tenantId, waGroupId: event.waGroupId, waUserId: event.waUserId });
      const lines = [
        "📊 Status do bot:",
        `Gateway: ${status.gateway.ok ? "ok" : "erro"}${status.gateway.at ? ` (${status.gateway.at})` : ""}`,
        `Worker: ${status.worker.ok ? "ok" : "erro"}${status.worker.at ? ` (${status.worker.at})` : ""}`,
        `DB: ${status.db.ok ? "ok" : "erro"}`,
        `Redis: ${status.redis.ok ? "ok" : "erro"}`,
        `LLM: ${status.llm.enabled ? (status.llm.ok ? "ok" : `erro (${status.llm.reason ?? "desconhecido"})`) : "desativado"}`,
        `Tarefas abertas: ${status.counts.tasksOpen}`,
        `Lembretes agendados: ${status.counts.remindersScheduled}`,
        `Timers agendados: ${status.counts.timersScheduled}`
      ];
      if (status.queue) {
        lines.push(
          `Fila: waiting=${status.queue.waiting ?? 0}, active=${status.queue.active ?? 0}, delayed=${status.queue.delayed ?? 0}`
        );
      }
      return [{ type: "reply", text: lines.join("\n") }];
    }

    if (lower.startsWith("/reminder ")) {
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

    // Muted guard: skip LLM/triggers fallback when muted
    if (isMuted) {
      const until = muteInfo?.until ? formatDateTimeInZone(muteInfo.until, timezone) : "(desconhecido)";
      return [{ type: "reply", text: `🤫 Estou em silêncio até ${until}. Envie /mute off para reativar.` }];
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
      const promptOverride = await this.ports.prompt.resolvePrompt({ tenantId: event.tenantId, waGroupId: event.waGroupId });
      const system =
        promptOverride ??
        this.ports.baseSystemPrompt ??
        "Você é Zappy, uma secretária eficiente e direta no WhatsApp. Ajude com tarefas, lembretes e respostas objetivas.";
      try {
        const llmText = await this.ports.llm.chat({ system, messages: [...messages, { role: "user", content: event.text }] });
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
