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

const parseReminder = (text: string, now: Date): { remindAt: Date; message: string } | null => {
  const inMatch = text.match(/^\/reminder\s+in\s+(\d+)\s+(.+)$/i);
  if (inMatch) {
    const minutes = Number.parseInt(inMatch[1], 10);
    if (Number.isNaN(minutes) || minutes <= 0) return null;
    return { remindAt: new Date(now.getTime() + minutes * 60_000), message: inMatch[2].trim() };
  }

  const atMatch = text.match(/^\/reminder\s+at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/i);
  if (!atMatch) return null;
  const remindAt = new Date(`${atMatch[1]}T${atMatch[2]}:00`);
  if (Number.isNaN(remindAt.getTime())) return null;
  return { remindAt, message: atMatch[3].trim() };
};

export class Orchestrator {
  private readonly ports: CorePorts;

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
            date: (this.ports.clock?.now() ?? new Date()).toISOString()
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
            "/reminder in <minutes> <message>",
            "/reminder at <YYYY-MM-DD HH:MM> <message>"
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
      const parsed = parseReminder(cmd, this.ports.clock?.now() ?? new Date());
      if (!parsed) return [{ type: "reply", text: "Invalid reminder format." }];
      const reminder = await this.ports.remindersRepository.createReminder({
        tenantId: event.tenantId,
        waUserId: event.waUserId,
        waGroupId: event.waGroupId,
        message: parsed.message,
        remindAt: parsed.remindAt
      });
      return [
        { type: "reply", text: `Reminder set for ${parsed.remindAt.toISOString()}` },
        { type: "enqueue_reminder", reminderId: reminder.id, remindAt: parsed.remindAt }
      ];
    }

    if (assistantMode !== "off") {
      const messages = await this.ports.messagesRepository.getRecentMessages({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId,
        limit: 10
      });
      const system =
        (await this.ports.prompt.resolvePrompt({ tenantId: event.tenantId, waGroupId: event.waGroupId })) ??
        "You are a concise WhatsApp assistant.";
      const llmText = await this.ports.llm.chat({
        system,
        messages: [...messages, { role: "user", content: event.text }]
      });
      return [{ type: "reply", text: llmText }];
    }

    return [{ type: "noop" }];
  }
}
