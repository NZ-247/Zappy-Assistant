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

export type MessageKind = "text" | "media" | "system" | "unknown";

export type MessageClassificationKind =
  | "system_event"
  | "ignored_event"
  | "command"
  | "trigger_candidate"
  | "ai_candidate"
  | "tool_follow_up";

export interface MessageClassification {
  kind: MessageClassificationKind;
  reason?: string;
  commandName?: string;
}

export interface InboundMessageEvent {
  tenantId: string;
  conversationId?: string;
  waGroupId?: string;
  waUserId: string;
  text: string;
  waMessageId: string;
  timestamp: Date;
  isGroup: boolean;
  kind?: MessageKind;
  remoteJid?: string;
  isStatusBroadcast?: boolean;
  isFromBot?: boolean;
  hasMedia?: boolean;
  rawMessageType?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type ToolAction =
  | "create_task"
  | "list_tasks"
  | "create_reminder"
  | "list_reminders"
  | "add_note"
  | "list_notes"
  | "get_time"
  | "get_settings";

export interface ToolIntent {
  action: ToolAction;
  payload?: Record<string, unknown>;
  confidence?: number;
  reason?: string;
}

export interface AiTextReply {
  kind: "text";
  text: string;
  meta?: Record<string, unknown>;
}

export interface AiToolIntent {
  kind: "tool_suggestion";
  tool: ToolIntent;
  text?: string;
  meta?: Record<string, unknown>;
}

export interface AiFallback {
  kind: "fallback";
  reason: string;
  text?: string;
}

export type AiResponse = AiTextReply | AiToolIntent | AiFallback;

export interface AiAssistantInput {
  tenantId: string;
  conversationId?: string;
  waUserId: string;
  waGroupId?: string;
  userText: string;
  chatScope: "direct" | "group";
  userRole: "ROOT" | "DONO" | "GROUP_ADMIN" | "ADMIN" | "MEMBER";
  modulesEnabled?: string[];
  availableTools?: ToolAction[];
  conversationState?: string;
  handoffActive?: boolean;
  settings?: { timezone?: string; language?: string; formality?: "formal" | "neutral" | "casual" };
  now: Date;
  llmEnabled?: boolean;
  personaId?: string;
}

export interface AiAssistantPort {
  generate(input: AiAssistantInput): Promise<AiResponse>;
}

export type ConversationState =
  | "NONE"
  | "WAITING_CONFIRMATION"
  | "WAITING_TASK_DETAILS"
  | "WAITING_REMINDER_DETAILS"
  | "HANDOFF_ACTIVE";

export interface ConversationStateRecord {
  state: ConversationState;
  context?: Record<string, unknown>;
  updatedAt: Date;
  expiresAt?: Date | null;
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

export interface ReplyTextAction {
  kind: "reply_text";
  text: string;
}

export interface ReplyListItem {
  title: string;
  description?: string;
}

export interface ReplyListAction {
  kind: "reply_list";
  header?: string;
  items: ReplyListItem[];
  footer?: string;
}

export interface EnqueueJobAction {
  kind: "enqueue_job";
  jobType: "reminder" | "timer" | string;
  payload: { id: string; runAt?: Date; [key: string]: unknown };
}

export interface NoopAction {
  kind: "noop";
  reason?: string;
}

export interface ErrorAction {
  kind: "error";
  message: string;
  reason?: string;
}

export interface HandoffAction {
  kind: "handoff";
  target: "human" | "agent";
  note?: string;
}

export interface AiToolSuggestionAction {
  kind: "ai_tool_suggestion";
  tool: ToolIntent;
  text?: string;
}

export type ResponseAction =
  | ReplyTextAction
  | ReplyListAction
  | EnqueueJobAction
  | NoopAction
  | ErrorAction
  | HandoffAction
  | AiToolSuggestionAction;
export type OrchestratorAction = ResponseAction;

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

export interface ConversationMemoryItem {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  metadataJson?: unknown;
  createdAt: Date;
}

export interface ConversationMemoryPort {
  appendMemory(input: {
    tenantId: string;
    conversationId: string;
    waUserId?: string;
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    metadataJson?: unknown;
    keepLatest?: number;
  }): Promise<void>;
  listRecentMemory(input: { conversationId: string; limit: number }): Promise<ConversationMemoryItem[]>;
  trimOldMemory?(conversationId: string, keepLatestN: number): Promise<void>;
  clearMemory?(conversationId: string): Promise<void>;
}

export interface CooldownPort {
  canFire(key: string, ttlSeconds: number): Promise<boolean>;
}

export interface RateLimitPort {
  allow(key: string, max: number, windowSeconds: number): Promise<boolean>;
}

export interface ConversationStatePort {
  getState(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<ConversationStateRecord | null>;
  setState(input: {
    tenantId: string;
    waGroupId?: string;
    waUserId: string;
    state: ConversationState;
    context?: Record<string, unknown>;
    expiresAt?: Date | null;
  }): Promise<void>;
  clearState(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<void>;
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
  conversationMemory?: ConversationMemoryPort;
  aiAssistant?: AiAssistantPort;
  prompt: PromptPort;
  cooldown: CooldownPort;
  rateLimit: RateLimitPort;
  queue: QueuePort;
  llm: LlmPort;
  mute?: MutePort;
  identity?: IdentityPort;
  status?: StatusPort;
  conversationState?: ConversationStatePort;
  clock?: ClockPort;
  logger?: LoggerPort;
  botName?: string;
  defaultAssistantMode?: "off" | "professional" | "fun" | "mixed";
  defaultFunMode?: "off" | "on";
  llmEnabled?: boolean;
  timezone?: string;
  defaultReminderTime?: string;
  baseSystemPrompt?: string;
  llmMemoryMessages?: number;
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

type NormalizedEvent = InboundMessageEvent & {
  normalizedText: string;
  messageKind: MessageKind;
  isStatusBroadcast: boolean;
  isFromBot: boolean;
  hasMedia: boolean;
};

type PipelineContext = {
  event: NormalizedEvent;
  scope: { scope: Scope; scopeId: string };
  flags: Record<string, string>;
  assistantMode: "off" | "professional" | "fun" | "mixed";
  funMode: "off" | "on";
  downloadsMode: "off" | "allowlist" | "on";
  timezone: string;
  now: Date;
  defaultReminderTime: string;
  classification: MessageClassification;
  muteInfo?: { until: Date } | null;
  conversationState: ConversationStateRecord;
  identity?: { displayName: string; role: string; permissions: string[]; groupName?: string };
  recentMessages: ConversationMessage[];
  policyMuted: boolean;
};

export class Orchestrator {
  private readonly ports: CorePorts;
  private readonly llmUnavailableText =
    "No momento estou sem acesso ao assistente inteligente. Você ainda pode usar /help, /task e /reminder.";
  private readonly dedupTtlSeconds = 12;

  constructor(ports: CorePorts) {
    this.ports = ports;
  }

  private getScope(event: InboundMessageEvent): { scope: Scope; scopeId: string } {
    return event.waGroupId ? { scope: "GROUP", scopeId: event.waGroupId } : { scope: "USER", scopeId: event.waUserId };
  }

  private mapMemoryToMessages(entries: ConversationMemoryItem[]): ConversationMessage[] {
    return entries
      .filter((item) => item.role !== "tool")
      .map((item) => {
        const role: ConversationMessage["role"] = item.role === "assistant" ? "assistant" : item.role === "system" ? "system" : "user";
        return { role, content: item.content };
      });
  }

  private async storeAiMemory(ctx: PipelineContext, assistantText: string): Promise<void> {
    if (!this.ports.conversationMemory) return;
    if (!ctx.event.conversationId) return;
    const keepLatest = this.ports.llmMemoryMessages ?? 10;
    const base = {
      tenantId: ctx.event.tenantId,
      conversationId: ctx.event.conversationId,
      waUserId: ctx.event.waUserId,
      keepLatest
    };
    try {
      await this.ports.conversationMemory.appendMemory({ ...base, role: "user", content: ctx.event.text });
      await this.ports.conversationMemory.appendMemory({ ...base, role: "assistant", content: assistantText });
    } catch (error) {
      this.ports.logger?.warn?.({ err: error, conversationId: ctx.event.conversationId }, "failed to store ai memory");
    }
  }

  private normalizeUserRole(role?: string): AiAssistantInput["userRole"] {
    const upper = role?.toUpperCase?.();
    if (upper === "ROOT") return "ROOT";
    if (upper === "DONO") return "DONO";
    if (upper === "GROUP_ADMIN" || upper === "ADMIN") return upper === "ADMIN" ? "ADMIN" : "GROUP_ADMIN";
    return "MEMBER";
  }

  private normalizeEvent(event: InboundMessageEvent): NormalizedEvent {
    const rawText = typeof event.text === "string" ? event.text : "";
    const normalizedText = rawText.trim();
    const messageKind = event.kind ?? (normalizedText ? "text" : event.hasMedia ? "media" : "unknown");
    return {
      ...event,
      text: rawText,
      normalizedText,
      messageKind,
      isStatusBroadcast: Boolean(event.isStatusBroadcast || event.remoteJid === "status@broadcast"),
      isFromBot: Boolean(event.isFromBot),
      hasMedia: Boolean(event.hasMedia)
    };
  }

  private async enforceRateLimits(event: NormalizedEvent): Promise<{ allowed: boolean; action?: ResponseAction }> {
    const userKey = `rate:user:${event.tenantId}:${event.waUserId}`;
    const allowedUser = await this.ports.rateLimit.allow(userKey, 20, 60);
    if (!allowedUser) return { allowed: false, action: { kind: "reply_text", text: "Rate limit exceeded. Please wait a bit." } };
    if (event.waGroupId) {
      const groupKey = `rate:group:${event.tenantId}:${event.waGroupId}`;
      const allowedGroup = await this.ports.rateLimit.allow(groupKey, 120, 60);
      if (!allowedGroup)
        return {
          allowed: false,
          action: { kind: "reply_text", text: "O grupo está enviando mensagens rápido demais. Aguarde um pouco." }
        };
    }
    return { allowed: true };
  }

  private async buildContext(event: NormalizedEvent): Promise<PipelineContext> {
    const flags = await this.ports.flagsRepository.resolveFlags({
      tenantId: event.tenantId,
      waGroupId: event.waGroupId,
      waUserId: event.waUserId
    });

    const timezone = normalizeTimezone(this.ports.timezone);
    const now = this.ports.clock?.now() ?? new Date();
    const defaultReminderTime = this.ports.defaultReminderTime ?? DEFAULT_REMINDER_TIME;

    const assistantMode = (flags.assistant_mode ?? this.ports.defaultAssistantMode ?? "professional") as
      | "off"
      | "professional"
      | "fun"
      | "mixed";
    const funMode = (flags.fun_mode ?? this.ports.defaultFunMode ?? "off") as "off" | "on";
    const downloadsMode = (flags.downloads_mode ?? "off") as "off" | "allowlist" | "on";

    const scope = this.getScope(event);
    const muteInfo = this.ports.mute
      ? await this.ports.mute.getMuteState({ tenantId: event.tenantId, scope: scope.scope, scopeId: scope.scopeId })
      : null;
    const conversationState =
      (await this.ports.conversationState?.getState({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId
      })) ?? { state: "NONE", updatedAt: now };
    const identity = this.ports.identity
      ? await this.ports.identity.getIdentity({
          tenantId: event.tenantId,
          waGroupId: event.waGroupId,
          waUserId: event.waUserId
        })
      : undefined;
    const memoryLimit = this.ports.llmMemoryMessages ?? 10;
    const recentMessages = this.ports.conversationMemory && event.conversationId
      ? this.mapMemoryToMessages(
          await this.ports.conversationMemory.listRecentMemory({
            conversationId: event.conversationId,
            limit: memoryLimit
          })
        )
      : await this.ports.messagesRepository.getRecentMessages({
          tenantId: event.tenantId,
          waGroupId: event.waGroupId,
          waUserId: event.waUserId,
          limit: memoryLimit
        });

    return {
      event,
      scope,
      flags,
      assistantMode,
      funMode,
      downloadsMode,
      timezone,
      now,
      defaultReminderTime,
      classification: { kind: "ignored_event" },
      muteInfo,
      conversationState,
      identity,
      recentMessages,
      policyMuted: false
    };
  }

  private async isDuplicate(event: NormalizedEvent): Promise<boolean> {
    if (!event.normalizedText) return false;
    const key = `dup:${event.tenantId}:${event.waGroupId ?? event.waUserId}:${event.normalizedText.slice(0, 80).toLowerCase()}`;
    return !(await this.ports.cooldown.canFire(key, this.dedupTtlSeconds));
  }

  private isEchoFromAssistant(ctx: PipelineContext): boolean {
    const lastAssistant = [...ctx.recentMessages].reverse().find((m) => m.role === "assistant");
    return Boolean(lastAssistant && lastAssistant.content.trim() === ctx.event.normalizedText);
  }

  private async classifyMessage(ctx: PipelineContext): Promise<MessageClassification> {
    const { event } = ctx;

    if (event.isStatusBroadcast) return { kind: "ignored_event", reason: "status_broadcast" };
    if (event.isFromBot) return { kind: "ignored_event", reason: "from_bot" };
    if (event.messageKind === "system") return { kind: "system_event" };
    if (!event.normalizedText && !event.hasMedia) return { kind: "ignored_event", reason: "empty_payload" };
    if (event.hasMedia && !event.normalizedText && ctx.downloadsMode === "off") {
      return { kind: "ignored_event", reason: "media_not_allowed" };
    }
    if (await this.isDuplicate(event)) return { kind: "ignored_event", reason: "duplicate" };
    if (this.isEchoFromAssistant(ctx)) return { kind: "ignored_event", reason: "loop_guard" };
    if (ctx.conversationState.state !== "NONE") return { kind: "tool_follow_up", reason: ctx.conversationState.state };
    if (event.normalizedText.startsWith("/")) {
      return { kind: "command", commandName: event.normalizedText.split(/\s+/)[0] };
    }
    if (event.normalizedText.length > 120 || event.normalizedText.includes("?") || event.normalizedText.split(/\s+/).length > 6) {
      return { kind: "ai_candidate" };
    }
    return { kind: "trigger_candidate" };
  }

  private applyPolicies(ctx: PipelineContext): { stop?: ResponseAction[] } {
    if (ctx.conversationState.state === "HANDOFF_ACTIVE") {
      return { stop: [{ kind: "handoff", target: "human", note: "Handoff ativo para este chat." }] };
    }
    const muteActive = ctx.muteInfo && ctx.muteInfo.until.getTime() > ctx.now.getTime();
    if (muteActive) ctx.policyMuted = true;
    return {};
  }

  private formatList(action: ReplyListAction): string {
    const lines: string[] = [];
    if (action.header) lines.push(action.header);
    lines.push(
      ...action.items.map((item) => {
        const desc = item.description ? ` — ${item.description}` : "";
        return `• ${item.title}${desc}`;
      })
    );
    if (action.footer) lines.push(action.footer);
    return lines.join("\n");
  }

  private formatActionsForDelivery(actions: ResponseAction[]): ResponseAction[] {
    return actions.map((action) => {
      if (action.kind === "reply_list") {
        return { kind: "reply_text", text: this.formatList(action) };
      }
      if (action.kind === "error") {
        return { kind: "reply_text", text: `⚠️ ${action.message}` };
      }
      return action;
    });
  }

  private buildMuteText(muteInfo: { until: Date } | null | undefined, timezone: string): string {
    const until = muteInfo?.until ? formatDateTimeInZone(muteInfo.until, timezone) : "(desconhecido)";
    return `🤫 Estou em silêncio até ${until}. Envie /mute off para reativar.`;
  }

  private buildAwaitingStateText(state: ConversationState): string {
    switch (state) {
      case "WAITING_CONFIRMATION":
        return "Ainda estou aguardando sua confirmação. Responda com 'sim' ou 'não'.";
      case "WAITING_TASK_DETAILS":
        return "Preciso dos detalhes da tarefa para continuar. Envie o título ou use /task add <título>.";
      case "WAITING_REMINDER_DETAILS":
        return "Envie o texto do lembrete ou use /reminder in <duração> <mensagem>.";
      case "HANDOFF_ACTIVE":
        return "O atendimento humano já foi acionado. Aguarde, por favor.";
      default:
        return "Estou aguardando mais informações para continuar.";
    }
  }

  private async runTriggerStage(ctx: PipelineContext): Promise<ResponseAction[]> {
    if (ctx.policyMuted) return [];
    if (ctx.classification.kind === "command") return [];
    if (ctx.classification.kind === "ignored_event" || ctx.classification.kind === "system_event") return [];

    const triggers = await this.ports.triggersRepository.findActiveByScope({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId
    });

    const bot = this.ports.botName ?? "Zappy";
    const nowFormatted = formatDateTimeInZone(ctx.now, ctx.timezone);

    for (const trigger of triggers) {
      if (!trigger.enabled) continue;
      if (!isMatch(ctx.event.normalizedText, trigger)) continue;
      if (trigger.name.toLowerCase().includes("fun") && ctx.funMode !== "on") continue;

      const scopePart = ctx.event.waGroupId ?? ctx.event.waUserId;
      const key = `cooldown:${trigger.id}:${scopePart}`;
      const canFire = await this.ports.cooldown.canFire(key, Math.max(1, trigger.cooldownSeconds));
      if (!canFire) continue;

      return [
        {
          kind: "reply_text",
          text: renderTemplate(trigger.responseTemplate, {
            user: ctx.event.waUserId,
            group: ctx.event.waGroupId ?? "direct",
            bot,
            date: nowFormatted
          })
        }
      ];
    }

    return [];
  }

  private async runCommandRouter(ctx: PipelineContext): Promise<ResponseAction[]> {
    const cmd = ctx.event.normalizedText;
    const lower = cmd.toLowerCase();

    if (!lower.startsWith("/")) return [];

    if (lower === "/help") {
      return [{ kind: "reply_text", text: buildHelpText() }];
    }

    if (lower.startsWith("/task add ")) {
      const title = cmd.replace(/^(\/task add)\s+/i, "").trim();
      if (!title) return [{ kind: "reply_text", text: "Task title is required." }];
      const task = await this.ports.tasksRepository.addTask({
        tenantId: ctx.event.tenantId,
        title,
        createdByWaUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId
      });
      return [{ kind: "reply_text", text: `Task created: ${task.id} - ${task.title}` }];
    }

    if (lower === "/task list") {
      const tasks = await this.ports.tasksRepository.listTasks({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
      if (tasks.length === 0) return [{ kind: "reply_text", text: "No tasks yet." }];
      return [
        {
          kind: "reply_list",
          header: "Tarefas",
          items: tasks.map((t) => ({
            title: `${t.done ? "✅" : "⬜"} ${t.id}`,
            description: t.title
          }))
        }
      ];
    }

    if (lower.startsWith("/task done ")) {
      const taskId = cmd.replace(/^(\/task done)\s+/i, "").trim();
      const done = await this.ports.tasksRepository.markDone({
        tenantId: ctx.event.tenantId,
        taskId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
      return [{ kind: "reply_text", text: done ? `Task ${taskId} marked done.` : `Task ${taskId} not found.` }];
    }

    if (lower.startsWith("/note add ")) {
      if (!this.ports.notesRepository) return [{ kind: "reply_text", text: "Notes module is not available." }];
      const text = cmd.replace(/^(\/note add)\s+/i, "").trim();
      if (!text) return [{ kind: "reply_text", text: "Note text is required." }];
      const note = await this.ports.notesRepository.addNote({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        text,
        scope: ctx.scope.scope
      });
      return [{ kind: "reply_text", text: `Nota ${note.publicId} salva.` }];
    }

    if (lower === "/note list") {
      if (!this.ports.notesRepository) return [{ kind: "reply_text", text: "Notes module is not available." }];
      const notes = await this.ports.notesRepository.listNotes({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        scope: ctx.scope.scope,
        limit: 10
      });
      if (notes.length === 0) return [{ kind: "reply_text", text: "Nenhuma nota ainda." }];
      return [
        {
          kind: "reply_list",
          header: "Notas",
          items: notes.map((n) => ({ title: n.publicId, description: truncate(n.text, 50) }))
        }
      ];
    }

    if (lower.startsWith("/note rm ")) {
      if (!this.ports.notesRepository) return [{ kind: "reply_text", text: "Notes module is not available." }];
      const publicId = cmd.replace(/^(\/note rm)\s+/i, "").trim().toUpperCase();
      if (!publicId) return [{ kind: "reply_text", text: "Informe o ID da nota (ex: N001)." }];
      const removed = await this.ports.notesRepository.removeNote({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        publicId
      });
      return [{ kind: "reply_text", text: removed ? `Nota ${publicId} removida.` : `Nota ${publicId} não encontrada.` }];
    }

    if (lower === "/agenda") {
      const range = getDayRange({ date: ctx.now, timezone: ctx.timezone });
      const tasks = await this.ports.tasksRepository.listTasksForDay({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        dayStart: range.start,
        dayEnd: range.end
      });
      const reminders = await this.ports.remindersRepository.listForDay({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        dayStart: range.start,
        dayEnd: range.end
      });
      return [{ kind: "reply_text", text: formatAgenda({ dateLabel: range.label, timezone: ctx.timezone, tasks, reminders }) }];
    }

    if (lower.startsWith("/calc ")) {
      const expression = cmd.replace(/^(\/calc)\s+/i, "").trim();
      if (!expression) return [{ kind: "reply_text", text: "Forneça uma expressão (ex: 5+10*3)." }];
      try {
        const result = evaluateExpression(expression);
        return [{ kind: "reply_text", text: `${expression} = ${result}` }];
      } catch (error) {
        return [{ kind: "reply_text", text: `Expressão inválida: ${(error as Error).message}` }];
      }
    }

    if (lower.startsWith("/timer ")) {
      if (!this.ports.timersRepository) return [{ kind: "reply_text", text: "Timer module is not available." }];
      const durationToken = cmd.replace(/^(\/timer)\s+/i, "").trim();
      const duration = parseDurationInput(durationToken);
      if (!duration) return [{ kind: "reply_text", text: "Formato de duração inválido. Use algo como 10m ou 1h." }];
      const { date, pretty } = addDurationToNow({ durationMs: duration.milliseconds, timezone: ctx.timezone, now: ctx.now });
      const timer = await this.ports.timersRepository.createTimer({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        fireAt: date,
        durationMs: duration.milliseconds,
        label: duration.pretty
      });
      return [
        { kind: "reply_text", text: `Timer ${timer.id} definido para ${pretty} (${ctx.timezone}).` },
        { kind: "enqueue_job", jobType: "timer", payload: { id: timer.id, runAt: date } }
      ];
    }

    if (lower.startsWith("/mute")) {
      if (!this.ports.mute) return [{ kind: "reply_text", text: "Mute control is not available." }];
      const arg = cmd.replace(/^\/mute\s*/i, "").trim();
      if (arg.toLowerCase() === "off") {
        await this.ports.mute.unmute({ tenantId: ctx.event.tenantId, scope: ctx.scope.scope, scopeId: ctx.scope.scopeId });
        return [{ kind: "reply_text", text: "Silêncio desativado." }];
      }
      const duration = parseDurationInput(arg);
      if (!duration) return [{ kind: "reply_text", text: "Informe a duração (ex: 30m, 2h)." }];
      const muted = await this.ports.mute.mute({
        tenantId: ctx.event.tenantId,
        scope: ctx.scope.scope,
        scopeId: ctx.scope.scopeId,
        durationMs: duration.milliseconds,
        now: ctx.now
      });
      const untilPretty = formatDateTimeInZone(muted.until, ctx.timezone);
      return [{ kind: "reply_text", text: `🤫 Silenciado até ${untilPretty}.` }];
    }

    if (lower === "/whoami") {
      if (!this.ports.identity) {
        return [{ kind: "reply_text", text: `Você é ${ctx.event.waUserId}. Permissões básicas para comandos.` }];
      }
      const identity = this.ports.identity
        ? await this.ports.identity.getIdentity({
            tenantId: ctx.event.tenantId,
            waUserId: ctx.event.waUserId,
            waGroupId: ctx.event.waGroupId
          })
        : null;
      const lines = [
        `Usuário: ${identity?.displayName ?? ctx.event.waUserId}`,
        `Role: ${identity?.role ?? "member"}`,
        `Permissões: ${identity?.permissions.join(", ") || "nenhuma"}`
      ];
      if (identity?.groupName) lines.push(`Grupo: ${identity.groupName}`);
      return [{ kind: "reply_text", text: lines.join("\n") }];
    }

    if (lower === "/status") {
      if (!this.ports.status) return [{ kind: "reply_text", text: "Status não disponível." }];
      const status = await this.ports.status.getStatus({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
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
      return [{ kind: "reply_text", text: lines.join("\n") }];
    }

    if (lower.startsWith("/reminder ")) {
      const parsed = parseReminder(cmd, { now: ctx.now, timezone: ctx.timezone, defaultReminderTime: ctx.defaultReminderTime });
      if (!parsed) return [{ kind: "reply_text", text: "Invalid reminder format." }];
      const reminder = await this.ports.remindersRepository.createReminder({
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId,
        message: parsed.message,
        remindAt: parsed.remindAt
      });
      return [
        { kind: "reply_text", text: `Reminder ${reminder.id} set for ${parsed.pretty} (${ctx.timezone})` },
        { kind: "enqueue_job", jobType: "reminder", payload: { id: reminder.id, runAt: parsed.remindAt } }
      ];
    }

    return [];
  }

  private async runAiFallback(ctx: PipelineContext): Promise<ResponseAction[]> {
    if (ctx.policyMuted) return [];
    if (ctx.assistantMode === "off") return [];
    if (this.ports.llmEnabled === false) {
      return [{ kind: "reply_text", text: this.llmUnavailableText }];
    }

    if (this.ports.aiAssistant) {
      try {
        const result = await this.ports.aiAssistant.generate({
          tenantId: ctx.event.tenantId,
          conversationId: ctx.event.conversationId,
          waUserId: ctx.event.waUserId,
          waGroupId: ctx.event.waGroupId,
          userText: ctx.event.text,
          chatScope: ctx.event.isGroup ? "group" : "direct",
          userRole: this.normalizeUserRole(ctx.identity?.role),
          modulesEnabled: [],
          availableTools: ["create_task", "list_tasks", "create_reminder", "list_reminders", "add_note", "list_notes", "get_time", "get_settings"],
          conversationState: ctx.conversationState.state,
          handoffActive: ctx.conversationState.state === "HANDOFF_ACTIVE",
          settings: { timezone: ctx.timezone },
          now: ctx.now,
          llmEnabled: this.ports.llmEnabled
        });

        if (result.kind === "text") return [{ kind: "reply_text", text: result.text }];
        if (result.kind === "tool_suggestion") {
          return [
            {
              kind: "ai_tool_suggestion",
              tool: result.tool,
              text: result.text
            }
          ];
        }
        return [{ kind: "reply_text", text: result.text ?? this.llmUnavailableText }];
      } catch (error) {
        this.ports.logger?.warn?.(
          { err: error, tenantId: ctx.event.tenantId, waGroupId: ctx.event.waGroupId, waUserId: ctx.event.waUserId },
          "ai assistant failed"
        );
        return [{ kind: "reply_text", text: this.llmUnavailableText }];
      }
    }

    const promptOverride = await this.ports.prompt.resolvePrompt({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId
    });
    const system =
      promptOverride ??
      this.ports.baseSystemPrompt ??
      "Você é Zappy, uma secretária eficiente e direta no WhatsApp. Ajude com tarefas, lembretes e respostas objetivas.";

    try {
      const llmText = await this.ports.llm.chat({
        system,
        messages: [...ctx.recentMessages, { role: "user", content: ctx.event.text }]
      });
      if (!llmText) return [];
      await this.storeAiMemory(ctx, llmText);
      return [{ kind: "reply_text", text: llmText }];
    } catch (error) {
      const payload = {
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId,
        messageId: ctx.event.waMessageId,
        error,
        llmReason: error instanceof LlmError ? error.reason : "unknown"
      };
      if (this.ports.logger?.warn) {
        this.ports.logger.warn(payload, "llm fallback failed");
      } else {
        console.warn("llm fallback failed", payload);
      }
      return [{ kind: "reply_text", text: this.llmUnavailableText }];
    }
  }

  async handleInboundMessage(event: InboundMessageEvent): Promise<ResponseAction[]> {
    const normalized = this.normalizeEvent(event);
    const rate = await this.enforceRateLimits(normalized);
    if (!rate.allowed) return this.formatActionsForDelivery(rate.action ? [rate.action] : [{ kind: "noop", reason: "rate_limit" }]);

    const ctx = await this.buildContext(normalized);
    ctx.classification = await this.classifyMessage(ctx);

    if (ctx.classification.kind === "ignored_event" || ctx.classification.kind === "system_event") {
      return this.formatActionsForDelivery([{ kind: "noop", reason: ctx.classification.reason ?? ctx.classification.kind }]);
    }

    const policyResult = this.applyPolicies(ctx);
    if (policyResult.stop) return this.formatActionsForDelivery(policyResult.stop);

    const triggerActions = await this.runTriggerStage(ctx);
    if (triggerActions.length > 0) return this.formatActionsForDelivery(triggerActions);

    const commandActions = await this.runCommandRouter(ctx);
    if (commandActions.length > 0) return this.formatActionsForDelivery(commandActions);

    if (ctx.classification.kind === "tool_follow_up") {
      return this.formatActionsForDelivery([{ kind: "reply_text", text: this.buildAwaitingStateText(ctx.conversationState.state) }]);
    }

    const aiActions = await this.runAiFallback(ctx);
    if (aiActions.length > 0) return this.formatActionsForDelivery(aiActions);

    if (ctx.policyMuted) {
      return this.formatActionsForDelivery([{ kind: "reply_text", text: this.buildMuteText(ctx.muteInfo, ctx.timezone) }]);
    }

    return this.formatActionsForDelivery([{ kind: "noop", reason: "no_action" }]);
  }
}
