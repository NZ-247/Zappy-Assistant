import {
  addDurationToNow,
  DEFAULT_REMINDER_TIME,
  formatDateTimeInZone,
  getDayRange,
  normalizeTimezone,
  parseDateTimeWithZone,
  parseDurationInput
} from "./time.js";
import { resolveTargetUserFromMentionOrReply, requireGroupContext } from "./common/bot-common.js";
import {
  formatCommand,
  hasCommandPrefix as hasPrefix,
  normalizeCommandPrefix,
  stripCommandPrefix as stripPrefix
} from "./commands/parser/prefix.js";
import { createCommandRegistry } from "./commands/registry/index.js";
import type { CommandRegistry } from "./commands/registry/command-types.js";
import { parseCommandText } from "./commands/parser/parse-command.js";
import { handleGroupCommand } from "./modules/groups/presentation/commands/group-commands.js";
import { handleModerationCommand } from "./modules/moderation/presentation/commands/moderation-commands.js";
import { handleReminderCommand } from "./modules/reminders/presentation/commands/reminder-commands.js";
import { Parser } from "expr-eval";
import { DateTime } from "luxon";
import type {
  AuditEvent,
  CanonicalIdentity,
  ConversationMessage,
  ConversationState,
  ConversationStateRecord,
  GroupAccessState,
  GroupChatMode,
  GroupFunMode,
  GroupModerationSettings,
  InboundMessageEvent,
  MessageClassification,
  MessageClassificationKind,
  MessageKind,
  RelationshipProfile,
  MetricKey,
  Scope,
  ToolAction,
  ToolIntent,
  AiAssistantInput,
  AiResponse,
  ConsentStatus,
  UserConsentRecord,
  TriggerRule,
  ReminderCreateInput,
  ReminderRecord,
  NoteRecord,
  TimerStatus,
  TimerCreateInput,
  TimerRecord,
  TaskListItem,
  StatusSnapshot,
  LlmErrorReason,
  FlagValue
} from "./pipeline/types.js";
import { LlmError } from "./pipeline/types.js";
import type {
  ResponseAction,
  GroupAdminOperation,
  ModerationActionKind,
  GroupAdminAction,
  ReplyTextAction,
  ReplyListAction,
  EnqueueJobAction,
  NoopAction,
  ErrorAction,
  HandoffAction,
  AiToolSuggestionAction,
  ModerationAction,
  OrchestratorAction
} from "./pipeline/actions.js";
import type {
  CorePorts,
  GroupAccessPort,
  AdminAccessPort,
  FlagsRepositoryPort,
  TriggersRepositoryPort,
  TasksRepositoryPort,
  RemindersRepositoryPort,
  NotesRepositoryPort,
  TimersRepositoryPort,
  MessagesRepositoryPort,
  ConversationMemoryItem,
  ConversationMemoryPort,
  CooldownPort,
  RateLimitPort,
  ConversationStatePort,
  ConsentPort,
  QueuePort,
  LlmPort,
  PromptPort,
  MutePort,
  IdentityPort,
  StatusPort,
  ClockPort,
  LoggerPort,
  MetricsPort,
  AuditPort
} from "./pipeline/ports.js";
import type { PipelineContext, NormalizedEvent } from "./pipeline/context.js";

export { createCommandRegistry } from "./commands/registry/index.js";
export type { CommandDefinition, CommandMatch, CommandRegistry, CommandScope, CommandRequiredRole } from "./commands/registry/command-types.js";
export { formatCommand, normalizeCommandPrefix } from "./commands/parser/prefix.js";
export type {
  Scope,
  MatchType,
  RelationshipProfile,
  GroupChatMode,
  GroupFunMode,
  GroupModerationSettings,
  GroupAccessState,
  CanonicalIdentity,
  MessageKind,
  MessageClassificationKind,
  MessageClassification,
  MetricKey,
  AuditEvent,
  InboundMessageEvent,
  ConversationMessage,
  ConversationState,
  ConversationStateRecord,
  ToolAction,
  ToolIntent,
  AiResponse,
  AiAssistantInput,
  ConsentStatus,
  UserConsentRecord,
  LlmErrorReason,
  FlagValue,
  TriggerRule,
  ReminderCreateInput,
  ReminderRecord,
  NoteRecord,
  TimerStatus,
  TimerCreateInput,
  TimerRecord,
  TaskListItem,
  StatusSnapshot
} from "./pipeline/types.js";
export { LlmError } from "./pipeline/types.js";
export type {
  ReplyTextAction,
  ReplyListAction,
  EnqueueJobAction,
  NoopAction,
  ErrorAction,
  HandoffAction,
  AiToolSuggestionAction,
  GroupAdminOperation,
  GroupAdminAction,
  ModerationActionKind,
  ModerationAction,
  ResponseAction,
  OrchestratorAction
} from "./pipeline/actions.js";
export type {
  GroupAccessPort,
  AdminAccessPort,
  FlagsRepositoryPort,
  TriggersRepositoryPort,
  TasksRepositoryPort,
  RemindersRepositoryPort,
  NotesRepositoryPort,
  TimersRepositoryPort,
  MessagesRepositoryPort,
  ConversationMemoryItem,
  ConversationMemoryPort,
  CooldownPort,
  RateLimitPort,
  ConversationStatePort,
  ConsentPort,
  QueuePort,
  LlmPort,
  PromptPort,
  MutePort,
  IdentityPort,
  StatusPort,
  ClockPort,
  LoggerPort,
  MetricsPort,
  AuditPort,
  CorePorts
} from "./pipeline/ports.js";
export type { PipelineContext, NormalizedEvent } from "./pipeline/context.js";

const CREATOR_WA_NUMBER = "556699064658";
const MOTHER_WA_NUMBER = "556692283438";
const normalizeWaNumber = (value?: string | null): string => value?.replace(/\D/g, "") ?? "";

const knownPrivilegedNumbers = [CREATOR_WA_NUMBER, MOTHER_WA_NUMBER];

const hasRootPrivileges = (input: {
  permissionRole?: string | null;
  role?: string | null;
  relationshipProfile?: RelationshipProfile | null;
}): boolean => {
  const role = (input.permissionRole ?? input.role ?? "").toUpperCase();
  return role === "ROOT" || role === "DONO" || input.relationshipProfile === "creator_root";
};

const matchPrivilegedNumber = (candidates: string[]): { profile: RelationshipProfile; reason: string } | null => {
  const normalized = candidates.map((c) => normalizeWaNumber(c)).filter(Boolean);
  if (normalized.includes(CREATOR_WA_NUMBER)) return { profile: "creator_root", reason: "match:creator_number" };
  if (normalized.includes(MOTHER_WA_NUMBER)) return { profile: "mother_privileged", reason: "match:mother_number" };
  return null;
};

export const resolveRelationshipProfile = (input: {
  waUserId: string;
  phoneNumber?: string | null;
  pnJid?: string | null;
  lidJid?: string | null;
  aliases?: string[];
  identityRole?: string;
  storedProfile?: RelationshipProfile | null;
}): {
  profile: RelationshipProfile;
  reason: string;
} => {
  const candidates = [input.phoneNumber, input.pnJid, input.lidJid, input.waUserId, ...(input.aliases ?? [])].filter(Boolean) as string[];
  const privileged = matchPrivilegedNumber(candidates);
  if (privileged) {
    if (input.storedProfile && input.storedProfile !== privileged.profile) {
      return { profile: privileged.profile, reason: `${privileged.reason}_override_stored` };
    }
    return privileged;
  }

  if (input.storedProfile) return { profile: input.storedProfile, reason: "stored_profile" };

  const role = input.identityRole?.toUpperCase?.();
  if (role === "ROOT" || role === "DONO") return { profile: "delegated_owner", reason: "role:owner" };
  if (role === "ADMIN" || role === "GROUP_ADMIN") return { profile: "admin", reason: "role:admin" };

  return { profile: "member", reason: "default_member" };
};

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

const truncate = (text: string, max = 60): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const evaluateExpression = (expression: string): number => {
  const parser = new Parser({ operators: { logical: false, comparison: true }, allowMemberAccess: false });
  const result = parser.evaluate(expression);
  if (typeof result !== "number" || Number.isNaN(result) || !Number.isFinite(result)) throw new Error("Invalid expression result");
  return result;
};

const containsLink = (text: string): boolean => {
  const linkRegex = /(https?:\/\/\S+)|(www\.\S+)|(t\.me\/\S+)|(wa\.me\/\d+)|([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;
  const domainRegex = /\b[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?/i;
  return linkRegex.test(text) || domainRegex.test(text);
};

const buildCommandList = (prefix: string, isRoot: boolean): string[] => {
  const cmd = (body: string) => formatCommand(prefix, body);
  const commands = [
    cmd("help"),
    cmd("ping"),
    cmd("task add <title>"),
    cmd("task list"),
    cmd("task done <id>"),
    cmd("note add <text>"),
    cmd("note list"),
    cmd("note rm <id>"),
    cmd("agenda"),
    cmd("calc <expression>"),
    cmd("timer <duration>"),
    cmd("mute <duration>|off"),
    cmd("whoami"),
    cmd("userinfo (responda ou mencione)"),
    cmd("groupinfo"),
    cmd("rules (grupo)"),
    cmd("fix (grupo)"),
    cmd("chat on|off (grupo)"),
    cmd("set gp chat on|off (grupo, admin)"),
    cmd("set gp open|close (grupo, admin)"),
    cmd("set gp name <texto>"),
    cmd("set gp dcr <texto>"),
    cmd("set gp img (responda imagem)"),
    cmd("set gp fix <texto>"),
    cmd("set gp rules <texto>"),
    cmd("set gp welcome on|off|text <texto>"),
    cmd("add gp allowed_groups (grupo, admin)"),
    cmd("rm gp allowed_groups (grupo, admin)"),
    cmd("list gp allowed_groups"),
    cmd("add user admins <@> (admin)"),
    cmd("rm user admins <@>"),
    cmd("list user admins"),
    cmd("ban <@> (grupo, admin)"),
    cmd("kick <@> (grupo, admin)"),
    cmd("mute <@> <duração> (grupo, admin)"),
    cmd("unmute <@> (grupo, admin)"),
    cmd("hidetag <texto> (grupo, admin)"),
    cmd("status"),
    cmd("reminder in <duration> <message> (e.g. 10m, 1h30m)"),
    cmd("reminder at <DD-MM[-YYYY]> [HH:MM] <message>")
  ];
  if (isRoot) commands.push(cmd("alias link <phoneNumber> <lidJid> (ROOT/Admin)"));
  return commands;
};

const buildHelpText = (prefix: string, input?: {
  relationshipProfile?: RelationshipProfile | null;
  permissionRole?: string | null;
  role?: string | null;
}): string => {
  const isRoot = hasRootPrivileges({
    permissionRole: input?.permissionRole,
    role: input?.role,
    relationshipProfile: input?.relationshipProfile ?? null
  });
  const lines: string[] = [];
  if (isRoot) {
    lines.push("Contexto: ROOT/creator reconhecido. Você tem controle administrativo total; pode pedir ações diretas e estratégicas.");
  } else if (input?.relationshipProfile === "mother_privileged") {
    lines.push("Contexto: contato privilegiado (mãe). Vou responder com carinho e respeito extras.");
  } else if (input?.relationshipProfile === "creator_root") {
    lines.push("Contexto: creator_root detectado. Respostas mais proativas e complementares.");
  }
  lines.push("Commands:");
  lines.push(...buildCommandList(prefix, isRoot));
  return lines.join("\n");
};

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

type PendingToolContext = {
  pendingTool: ToolAction;
  missing: string[];
  provided?: Record<string, unknown>;
  summary?: string;
};

type DetectedIntent = {
  action: ToolAction;
  payload: Record<string, unknown>;
  missing: string[];
  reason: string;
};

export class Orchestrator {
  private readonly ports: CorePorts;
  private readonly llmUnavailableText: string;
  private readonly dedupTtlSeconds = 12;
  private readonly pendingStateTtlMs = 10 * 60 * 1000;
  private readonly greetingCooldownSeconds = 180;
  private readonly botAdminStaleMs = 3 * 60 * 1000;
  private readonly botAdminOperationStaleMs = 10 * 60 * 1000;
  private readonly consentTermsVersion: string;
  private readonly consentLink: string;
  private readonly consentSource: string;
  private readonly commandPrefix: string;
  private readonly commandRegistry: CommandRegistry;

  constructor(ports: CorePorts) {
    this.ports = ports;
    this.commandPrefix = normalizeCommandPrefix(ports.commandPrefix);
    this.commandRegistry = createCommandRegistry(this.commandPrefix);
    this.llmUnavailableText = `No momento estou sem acesso ao assistente inteligente. Você ainda pode usar ${formatCommand(this.commandPrefix, "help")}, ${formatCommand(this.commandPrefix, "task")} e ${formatCommand(this.commandPrefix, "reminder")}.`;
    this.consentTermsVersion = ports.consentTermsVersion ?? "2026-03";
    this.consentLink = ports.consentLink ?? "https://services.net.br/politicas";
    this.consentSource = ports.consentSource ?? "wa-gateway";
  }

  private async bumpMetric(key: MetricKey, by = 1): Promise<void> {
    if (!this.ports.metrics) return;
    try {
      await this.ports.metrics.increment(key, by);
    } catch (error) {
      this.ports.logger?.debug?.({ err: error, metric: key }, "metric increment failed");
    }
  }

  private async recordAudit(event: AuditEvent): Promise<void> {
    if (!this.ports.audit) return;
    try {
      await this.ports.audit.record(event);
    } catch (error) {
      this.ports.logger?.warn?.({ err: error, eventKind: event.kind }, "audit record failed");
    }
  }

  private hasCommandPrefix(text: string): boolean {
    return hasPrefix(text, this.commandPrefix);
  }

  private stripCommandPrefix(text: string): string {
    return stripPrefix(text, this.commandPrefix);
  }

  private normalizeCommandLower(text: string): string {
    return this.stripCommandPrefix(text).toLowerCase();
  }

  private hasRootPrivilege(ctx: PipelineContext): boolean {
    return hasRootPrivileges({
      permissionRole: ctx.identity?.permissionRole,
      role: ctx.identity?.role,
      relationshipProfile: ctx.relationshipProfile
    });
  }

  private isRequesterAdmin(ctx: PipelineContext): boolean {
    if (this.hasRootPrivilege(ctx)) return true;
    if (ctx.requesterIsGroupAdmin) return true;
    const role = (ctx.identity?.permissionRole ?? ctx.identity?.role ?? "").toUpperCase();
    if (["ADMIN", "GROUP_ADMIN", "OWNER", "DONO"].includes(role)) return true;
    return ctx.requesterIsAdmin;
  }

  private isAccessControlCommand(text: string): boolean {
    if (!this.hasCommandPrefix(text)) return false;
    const lower = this.normalizeCommandLower(text);
    return (
      lower === "add gp allowed_groups" ||
      lower === "rm gp allowed_groups" ||
      lower === "list gp allowed_groups" ||
      lower.startsWith("add user admins") ||
      lower.startsWith("rm user admins") ||
      lower === "list user admins" ||
      lower.startsWith("set gp chat") ||
      lower.startsWith("chat on") ||
      lower.startsWith("chat off")
    );
  }

  private commandRequiresGroupAdmin(commandName?: string): boolean {
    if (!commandName) return false;
    const cmd = this.normalizeCommandLower(commandName);
    if (cmd.startsWith("chat")) return true;
    if (cmd.startsWith("set gp chat")) return true;
    if (cmd.startsWith("set gp open") || cmd.startsWith("set gp close")) return true;
    if (cmd.startsWith("set gp name") || cmd.startsWith("set gp dcr") || cmd.startsWith("set gp img")) return true;
    if (cmd.startsWith("ban") || cmd.startsWith("kick") || cmd.startsWith("hidetag")) return true;
    if (cmd.startsWith("add gp allowed_groups")) return true;
    if (cmd.startsWith("rm gp allowed_groups")) return true;
    return false;
  }

  private shouldBypassConsent(ctx: PipelineContext): boolean {
    const role = (ctx.identity?.permissionRole ?? ctx.identity?.role ?? "").toUpperCase();
    const privilegedRoles = ["ROOT", "DONO", "OWNER", "ADMIN", "PRIVILEGED", "INTERNAL"];
    if (privilegedRoles.includes(role)) return true;
    if (
      ctx.relationshipProfile === "creator_root" ||
      ctx.relationshipProfile === "mother_privileged" ||
      ctx.relationshipProfile === "delegated_owner"
    )
      return true;
    return false;
  }

  private getScope(event: InboundMessageEvent): { scope: Scope; scopeId: string } {
    return event.waGroupId ? { scope: "GROUP", scopeId: event.waGroupId } : { scope: "USER", scopeId: event.waUserId };
  }

  private getMemoryLimitForProfile(profile: RelationshipProfile): number {
    const base = this.ports.llmMemoryMessages ?? 10;
    if (profile === "creator_root") return Math.max(base, 24);
    if (profile === "mother_privileged") return Math.max(base, 18);
    return base;
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
    const keepLatest = ctx.memoryLimit ?? this.ports.llmMemoryMessages ?? 10;
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
      hasMedia: Boolean(event.hasMedia),
      mentionedWaUserIds: event.mentionedWaUserIds ?? [],
      isBotMentioned: Boolean(event.isBotMentioned),
      isReplyToBot: Boolean(event.isReplyToBot),
      quotedWaMessageId: event.quotedWaMessageId,
      quotedWaUserId: event.quotedWaUserId,
      botIsGroupAdmin: event.botIsGroupAdmin,
      groupName: event.groupName
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
    const funModeFromFlags = (flags.fun_mode ?? this.ports.defaultFunMode ?? "off") as "off" | "on";
    let funMode = funModeFromFlags;
    const downloadsMode = (flags.downloads_mode ?? "off") as "off" | "allowlist" | "on";

    const scope = this.getScope(event);
    const muteInfo = this.ports.mute
      ? await this.ports.mute.getMuteState({ tenantId: event.tenantId, scope: scope.scope, scopeId: scope.scopeId })
      : null;
    const userMuteInfo =
      this.ports.mute && event.waGroupId
        ? await this.ports.mute.getMuteState({
            tenantId: event.tenantId,
            scope: "GROUP",
            scopeId: event.waGroupId,
            waUserId: event.waUserId
          })
        : null;
    let conversationState =
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
    if (conversationState.expiresAt && conversationState.expiresAt.getTime() <= now.getTime()) {
      await this.ports.conversationState?.clearState({
        tenantId: event.tenantId,
        waGroupId: event.waGroupId,
        waUserId: event.waUserId
      });
      conversationState = { state: "NONE", updatedAt: now };
    }

    const consent = await this.ports.consent.getConsent({
      tenantId: event.tenantId,
      waUserId: event.waUserId,
      termsVersion: this.consentTermsVersion
    });

    const groupAccess =
      event.waGroupId && this.ports.groupAccess
        ? await this.ports.groupAccess.getGroupAccess({
            tenantId: event.tenantId,
            waGroupId: event.waGroupId,
            groupName: identity?.groupName,
            botIsAdmin: event.botIsGroupAdmin
          })
        : undefined;
    if (groupAccess?.funMode) {
      funMode = groupAccess.funMode;
    }

    const relationship = resolveRelationshipProfile({
      waUserId: event.waUserId,
      phoneNumber: identity?.canonicalIdentity?.phoneNumber,
      pnJid: identity?.canonicalIdentity?.pnJid,
      lidJid: identity?.canonicalIdentity?.lidJid,
      aliases: identity?.canonicalIdentity?.aliases,
      identityRole: identity?.permissionRole ?? identity?.role,
      storedProfile: identity?.relationshipProfile ?? identity?.canonicalIdentity?.relationshipProfile ?? null
    });
    const memoryLimit = this.getMemoryLimitForProfile(relationship.profile);
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
    const groupChatMode = groupAccess?.chatMode ?? "on";
    const groupAllowed = event.isGroup ? (groupAccess ? Boolean(groupAccess.allowed) : true) : true;
    const botAdminCheckedAtTs = event.botAdminCheckedAt?.getTime?.() ?? groupAccess?.botAdminCheckedAt?.getTime?.() ?? undefined;
    const botAdminEventSource = event.botAdminStatusSource;
    const botAdminFreshWindow = botAdminEventSource === "operation" ? this.botAdminOperationStaleMs : this.botAdminStaleMs;
    const botAdminFresh = botAdminCheckedAtTs ? now.getTime() - botAdminCheckedAtTs < botAdminFreshWindow : false;
    const botAdminStatusSource = botAdminEventSource ?? (botAdminFresh ? "cache" : undefined);
    const botAdminResolutionPath: Array<{ source: string; value?: boolean; checkedAt?: Date }> = [];
    if (event.isGroup) {
      if (typeof event.botIsGroupAdmin === "boolean") {
        botAdminResolutionPath.push({
          source: `event:${event.botAdminStatusSource ?? "unknown"}`,
          value: event.botIsGroupAdmin,
          checkedAt: event.botAdminCheckedAt
        });
      }
      if (typeof groupAccess?.botIsAdmin === "boolean") {
        botAdminResolutionPath.push({
          source: botAdminFresh ? "db:fresh" : "db",
          value: groupAccess.botIsAdmin,
          checkedAt: groupAccess.botAdminCheckedAt ?? undefined
        });
      }
      botAdminResolutionPath.push({ source: "default:optimistic", value: true });
    }
    const chosenAdmin = botAdminResolutionPath.find((c) => c.value !== undefined) ?? { source: "direct", value: true };
    const botIsGroupAdmin = event.isGroup ? Boolean(chosenAdmin.value) : true;
    const botAdminSourceUsed = event.isGroup ? chosenAdmin.source : "direct";
    const mentionedWaUserIds = event.mentionedWaUserIds ?? [];
    const requesterIsAdmin =
      this.ports.adminAccess && event.waUserId
        ? await this.ports.adminAccess.isAdmin({ tenantId: event.tenantId, waUserId: event.waUserId })
        : false;
    const requesterIsGroupAdmin = Boolean(event.senderIsGroupAdmin);

    const ctx: PipelineContext = {
      event,
      scope,
      relationshipProfile: relationship.profile,
      relationshipReason: relationship.reason,
      flags,
      assistantMode,
      funMode,
      downloadsMode,
      timezone,
      now,
      defaultReminderTime,
      memoryLimit,
      classification: { kind: "ignored_event" },
      muteInfo,
      userMuteInfo,
      conversationState,
      consent,
      consentRequired: false,
      bypassConsent: false,
      consentVersion: this.consentTermsVersion,
      identity,
      groupAccess,
      groupAllowed,
      groupChatMode,
      groupIsOpen: groupAccess?.isOpen ?? true,
      groupWelcomeEnabled: groupAccess?.welcomeEnabled,
      groupWelcomeText: groupAccess?.welcomeText ?? null,
      groupFixedMessageText: groupAccess?.fixedMessageText ?? null,
      groupRulesText: groupAccess?.rulesText ?? null,
      groupModeration: groupAccess?.moderation,
      botIsGroupAdmin,
      botAdminStatusSource,
      botAdminSourceUsed,
      botAdminResolutionPath,
      botAdminCheckedAt: botAdminCheckedAtTs ? new Date(botAdminCheckedAtTs) : undefined,
      botAdminCheckFailed: Boolean(event.botAdminCheckFailed || botAdminStatusSource === "fallback"),
      botAdminCheckError: event.botAdminCheckError,
      isBotMentioned: Boolean(event.isBotMentioned),
      isReplyToBot: Boolean(event.isReplyToBot),
      mentionedWaUserIds,
      requesterIsAdmin,
      requesterIsGroupAdmin,
      recentMessages,
      policyMuted: false
    };

    ctx.bypassConsent = this.shouldBypassConsent(ctx);
    ctx.consentRequired =
      !ctx.bypassConsent &&
      (!consent || consent.termsVersion !== this.consentTermsVersion || consent.status !== "ACCEPTED");
    if (!ctx.consentRequired && ctx.conversationState.state === "WAITING_CONSENT") {
      await this.clearConversationState(ctx);
      ctx.conversationState = { state: "NONE", updatedAt: now };
    }

    return ctx;
  }

  private async isDuplicate(event: NormalizedEvent): Promise<boolean> {
    if (!event.normalizedText) return false;
    const key = `dup:${event.tenantId}:${event.waGroupId ?? event.waUserId}:${event.normalizedText.slice(0, 80).toLowerCase()}`;
    return !(await this.ports.cooldown.canFire(key, this.dedupTtlSeconds));
  }

  private normalizeGreetingText(text: string): string {
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  private isGreetingPattern(pattern: string): boolean {
    const normalized = this.normalizeGreetingText(pattern);
    const greetings = new Set(["oi", "oii", "ola", "bom dia", "boa tarde", "boa noite"]);
    return greetings.has(normalized);
  }

  private isGreetingMessage(text: string): boolean {
    const normalized = this.normalizeGreetingText(text);
    if (!normalized) return false;
    const tokens = normalized.split(" ");
    if (tokens.length > 2) return false;
    const singleGreetings = new Set(["oi", "oii", "ola"]);
    const duoGreetings = new Set(["bom dia", "boa tarde", "boa noite"]);
    if (tokens.length === 1) return singleGreetings.has(tokens[0]);
    const joined = tokens.join(" ");
    return duoGreetings.has(joined);
  }

  private getPriorMessages(ctx: PipelineContext): ConversationMessage[] {
    const history = ctx.recentMessages ?? [];
    if (history.length === 0) return [];
    const last = history[history.length - 1];
    const sameAsCurrent = last.role === "user" && last.content?.trim?.() === ctx.event.text?.trim?.();
    return sameAsCurrent ? history.slice(0, -1) : history;
  }

  private hasConversationContext(ctx: PipelineContext): boolean {
    const prior = this.getPriorMessages(ctx);
    return prior.length > 0;
  }

  private isPrivilegedChat(ctx: PipelineContext): boolean {
    if (this.hasRootPrivilege(ctx)) return true;
    return ["creator_root", "mother_privileged", "delegated_owner"].includes(ctx.relationshipProfile);
  }

  private isSmallTalkFollowUp(ctx: PipelineContext): boolean {
    if (!this.hasConversationContext(ctx)) return false;
    const normalized = this.normalizeGreetingText(ctx.event.normalizedText);
    if (!normalized) return false;
    const smallTalkTokens = new Set(["bele", "beleza", "ta", "t", "joia", "kk", "kkk"]);
    const tokens = normalized.split(" ");
    if (tokens.length > 3) return false;
    return tokens.every((token) => smallTalkTokens.has(token)) || smallTalkTokens.has(normalized);
  }

  private shouldSkipGenericGreeting(ctx: PipelineContext): boolean {
    if (this.isPrivilegedChat(ctx)) return true;
    if (this.hasConversationContext(ctx)) return true;
    if (this.isSmallTalkFollowUp(ctx)) return true;
    return false;
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
    if (ctx.conversationState.state === "WAITING_CONSENT") return { kind: "consent_pending", reason: "consent_required" };
    if (!event.normalizedText && !event.hasMedia) return { kind: "ignored_event", reason: "empty_payload" };
    if (event.hasMedia && !event.normalizedText && ctx.downloadsMode === "off") {
      return { kind: "ignored_event", reason: "media_not_allowed" };
    }
    if (await this.isDuplicate(event)) return { kind: "ignored_event", reason: "duplicate" };
    if (this.isEchoFromAssistant(ctx)) return { kind: "ignored_event", reason: "loop_guard" };
    if (ctx.conversationState.state !== "NONE") return { kind: "tool_follow_up", reason: ctx.conversationState.state };
    const parsedCommand = parseCommandText(event.normalizedText, this.commandRegistry);
    if (parsedCommand) {
      const match = parsedCommand.match;
      const commandName = match?.command.name ?? parsedCommand.token;
      return { kind: "command", commandName, commandKnown: Boolean(match), reason: match ? undefined : "unknown_command" };
    }
    if (event.isGroup && (ctx.isBotMentioned || ctx.isReplyToBot)) {
      return { kind: "ai_candidate", reason: "addressed_in_group" };
    }
    if (event.normalizedText.length > 120 || event.normalizedText.includes("?") || event.normalizedText.split(/\s+/).length > 6) {
      return { kind: "ai_candidate" };
    }
    return { kind: "trigger_candidate" };
  }

  private enforceGroupPolicies(ctx: PipelineContext): { stop?: ResponseAction[]; commandsOnly?: boolean } {
    if (!ctx.event.isGroup) return { commandsOnly: false };
    const isCommand = ctx.classification.kind === "command";
    const isToolFollowUp = ctx.classification.kind === "tool_follow_up";
    const isAccessCommand = this.isAccessControlCommand(ctx.event.normalizedText);
    const addressed = ctx.isBotMentioned || ctx.isReplyToBot;
    const directedToBot = isCommand || isToolFollowUp || addressed;
    const isPrivileged = this.isRequesterAdmin(ctx);
    const routingReason = isCommand
      ? "prefix"
      : ctx.isBotMentioned
        ? "mention"
        : ctx.isReplyToBot
          ? "reply"
          : isToolFollowUp
            ? "follow_up"
            : "none";

    if (ctx.event.isGroup && process.env.NODE_ENV !== "production") {
      const textPreview = ctx.event.normalizedText?.slice(0, 120)?.replace(/"/g, '\\"') ?? "";
      const routeLine = [
        "[GROUP_ROUTE]",
        `directedToBot=${directedToBot}`,
        `reason=${routingReason}`,
        `mention=${ctx.isBotMentioned}`,
        `reply=${ctx.isReplyToBot}`,
        `text="${textPreview}"`
      ].join(" ");
      this.ports.logger?.debug?.(routeLine);
    }

    if (!directedToBot) {
      return { stop: [{ kind: "noop", reason: "group_not_addressed" }] };
    }

    if (!ctx.groupAllowed) {
      if (isAccessCommand && isPrivileged) return { commandsOnly: true };
      const text = `Este grupo não está autorizado a usar o bot. Um admin deve enviar ${formatCommand(this.commandPrefix, "add gp allowed_groups")} para liberar. Comandos privados continuam disponíveis.`;
      return { stop: [{ kind: "reply_text", text: this.stylizeReply(ctx, text) }] };
    }

    if (ctx.groupChatMode === "off") {
      if (isCommand || isToolFollowUp || isAccessCommand) return { commandsOnly: true };
      return { stop: [{ kind: "noop", reason: "chat_mode_off" }] };
    }

    const requiresGroupAdmin = isCommand && this.commandRequiresGroupAdmin(ctx.classification.commandName);
    if (requiresGroupAdmin && (ctx.botAdminCheckFailed || !ctx.botIsGroupAdmin) && process.env.NODE_ENV !== "production") {
      this.ports.logger?.debug?.(
        {
          category: "BOT_ADMIN_GUARD",
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId,
          command: ctx.classification.commandName,
          guard: "requires_group_admin",
          decision: "proceed_operation_first",
          botIsAdmin: ctx.botIsGroupAdmin,
          sourceUsed: ctx.botAdminSourceUsed,
          statusSource: ctx.botAdminStatusSource,
          eventBotIsAdmin: ctx.event.botIsGroupAdmin,
          eventBotAdminSource: ctx.event.botAdminStatusSource,
          groupBotIsAdmin: ctx.groupAccess?.botIsAdmin,
          groupBotCheckedAt: ctx.groupAccess?.botAdminCheckedAt?.toISOString?.(),
          botAdminCheckedAt: ctx.botAdminCheckedAt?.toISOString?.(),
          resolutionPath: ctx.botAdminResolutionPath?.map((c) => ({ source: c.source, value: c.value })),
          checkFailed: ctx.botAdminCheckFailed,
          checkError: ctx.botAdminCheckError
        },
        "bot admin pre-check bypassed (operation-first)"
      );
    }

    if (!isCommand && !isToolFollowUp && !addressed) {
      return { stop: [{ kind: "noop", reason: "group_not_addressed" }] };
    }

    return { commandsOnly: false };
  }

  private applyPolicies(ctx: PipelineContext): { stop?: ResponseAction[] } {
    if (ctx.conversationState.state === "HANDOFF_ACTIVE") {
      return { stop: [{ kind: "handoff", target: "human", note: "Handoff ativo para este chat." }] };
    }
    const muteActive =
      (ctx.muteInfo && ctx.muteInfo.until.getTime() > ctx.now.getTime()) ||
      (ctx.userMuteInfo && ctx.userMuteInfo.until.getTime() > ctx.now.getTime());
    if (muteActive) ctx.policyMuted = true;
    return {};
  }

  private enforceModeration(ctx: PipelineContext): ResponseAction[] {
    if (!ctx.event.isGroup) return [];
    if (!ctx.groupModeration) return [];
    const actions: ResponseAction[] = [];
    const isAdmin = this.isRequesterAdmin(ctx);

    if (ctx.groupModeration.antiLink && !isAdmin && containsLink(ctx.event.normalizedText)) {
      if (ctx.groupModeration.autoDeleteLinks && ctx.event.messageKey) {
        actions.push({
          kind: "moderation_action",
          action: "delete_message",
          waGroupId: ctx.event.waGroupId!,
          messageKey: ctx.event.messageKey
        });
      }
      const warning = this.stylizeReply(ctx, "Links não são permitidos neste grupo.");
      actions.push({ kind: "reply_text", text: warning });
      if (ctx.groupModeration.tempMuteSeconds && ctx.event.waGroupId) {
        actions.push({
          kind: "moderation_action",
          action: "mute",
          waGroupId: ctx.event.waGroupId,
          targetWaUserId: ctx.event.waUserId,
          durationMs: ctx.groupModeration.tempMuteSeconds * 1000
        });
      }
      return actions;
    }

    return actions;
  }

  private normalizeConsentInput(text: string): string {
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  private buildConsentOnboardingText(): string {
    return [
      "Olá, seja bem-vindo!",
      "Sou Zappy, assistente digital da Services.NET.",
      "",
      "Antes de prosseguir, recomendamos que leia e aceite nossos Termos de Compromisso e a Política de Privacidade disponíveis em:",
      this.consentLink,
      "",
      "Para continuar, responda com: SIM",
      "Se não concordar, responda com: NÃO"
    ].join("\n");
  }

  private buildConsentReminderText(): string {
    return `Para continuar, preciso do seu consentimento. Leia: ${this.consentLink}. Responda SIM para aceitar ou NÃO para recusar.`;
  }

  private buildConsentAcceptedText(): string {
    return "Obrigado! Consentimento registrado. Sou Zappy, assistente digital da Services.NET. Posso ajudar com suporte, orçamento, agendamento ou dúvidas.";
  }

  private async setConsentWaitingState(ctx: PipelineContext): Promise<void> {
    if (!this.ports.conversationState) {
      ctx.conversationState = { state: "WAITING_CONSENT", updatedAt: ctx.now };
      return;
    }
    const expiresAt = new Date(ctx.now.getTime() + this.pendingStateTtlMs);
    await this.ports.conversationState.setState({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId,
      state: "WAITING_CONSENT",
      context: { termsVersion: this.consentTermsVersion },
      expiresAt
    });
    ctx.conversationState = { state: "WAITING_CONSENT", context: { termsVersion: this.consentTermsVersion }, updatedAt: ctx.now, expiresAt };
  }

  private async enforceConsent(ctx: PipelineContext): Promise<ResponseAction[]> {
    if (ctx.bypassConsent) return [];
    const needsConsent = ctx.consentRequired || ctx.classification.kind === "consent_pending";
    if (!needsConsent) return [];

    const normalized = this.normalizeConsentInput(ctx.event.normalizedText);
    const isYes = /^sim\b/.test(normalized) || normalized === "yes";
    const isNo = /^(nao\b|nao aceito|nao quero|nao concordo)/.test(normalized);
    const wantsTerms = normalized.includes("terms") || normalized.includes("termos") || normalized.includes("politica") || normalized.includes("politics");
    const prefixedHelp = `${this.commandPrefix.toLowerCase()}help`;
    const prefixedAjuda = `${this.commandPrefix.toLowerCase()}ajuda`;
    const wantsHelp = normalized === "ajuda" || normalized === "help" || normalized === prefixedHelp || normalized === prefixedAjuda;

    const ensurePending = async () => {
      if (!ctx.consent || ctx.consent.status !== "PENDING" || ctx.consent.termsVersion !== this.consentTermsVersion) {
        ctx.consent = await this.ports.consent.setConsentStatus({
          tenantId: ctx.event.tenantId,
          waUserId: ctx.event.waUserId,
          status: "PENDING",
          termsVersion: this.consentTermsVersion,
          source: this.consentSource,
          timestamp: ctx.now
        });
        await this.recordAudit({
          kind: "consent",
          tenantId: ctx.event.tenantId,
          waUserId: ctx.event.waUserId,
          waGroupId: ctx.event.waGroupId,
          status: "PENDING",
          version: this.consentTermsVersion
        });
        await this.bumpMetric("onboarding_pending_total");
      }
      await this.setConsentWaitingState(ctx);
    };

    if (isYes) {
      ctx.consent = await this.ports.consent.setConsentStatus({
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        status: "ACCEPTED",
        termsVersion: this.consentTermsVersion,
        source: this.consentSource,
        timestamp: ctx.now
      });
      await this.recordAudit({
        kind: "consent",
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId,
        status: "ACCEPTED",
        version: this.consentTermsVersion
      });
      await this.bumpMetric("onboarding_accepted_total");
      ctx.consentRequired = false;
      await this.clearConversationState(ctx);
      ctx.conversationState = { state: "NONE", updatedAt: ctx.now };
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.buildConsentAcceptedText(), { suggestNext: "organizar suporte, orçamento, agendamento ou dúvidas" }) }];
    }

    if (isNo) {
      ctx.consent = await this.ports.consent.setConsentStatus({
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        status: "DECLINED",
        termsVersion: this.consentTermsVersion,
        source: this.consentSource,
        timestamp: ctx.now
      });
      await this.recordAudit({
        kind: "consent",
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId,
        status: "DECLINED",
        version: this.consentTermsVersion
      });
      await this.setConsentWaitingState(ctx);
      return [
        {
          kind: "reply_text",
          text: this.stylizeReply(ctx, `Entendido. Não vou prosseguir sem seu consentimento. Se mudar de ideia, envie SIM após ler: ${this.consentLink}.`)
        }
      ];
    }

    if (wantsTerms) {
      await ensurePending();
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, `Termos de Compromisso e Política de Privacidade: ${this.consentLink}. Responda SIM para aceitar ou NÃO para recusar.`) }];
    }

    if (wantsHelp) {
      await ensurePending();
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.buildConsentReminderText()) }];
    }

    await ensurePending();
    const message =
      ctx.conversationState.state === "WAITING_CONSENT" ? this.buildConsentReminderText() : this.buildConsentOnboardingText();
    return [{ kind: "reply_text", text: this.stylizeReply(ctx, message) }];
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

  private stylizeReply(ctx: PipelineContext, text: string, options?: { suggestNext?: string }): string {
    if (ctx.relationshipProfile === "mother_privileged") {
      return `Pode deixar, Srta. Leidy. ${text}`;
    }
    if (ctx.relationshipProfile === "creator_root") {
      const extra = options?.suggestNext ? ` Posso também ${options.suggestNext}.` : "";
      return `${text}${extra}`;
    }
    return text;
  }

  private relationshipNote(profile: RelationshipProfile): string | null {
    if (profile === "creator_root")
      return "Perfil de relacionamento: creator_root. Seja mais proativo e estratégico, sugira próximos passos de forma concisa e levemente descontraída.";
    if (profile === "mother_privileged")
      return "Perfil de relacionamento: mother_privileged. Use tom doce, respeitoso e gentil, como um filho bem comportado; apelidos suaves só quando apropriado; nunca use tom romântico.";
    return null;
  }

  private sanitizeAiText(ctx: PipelineContext, text: string): string {
    if (!text) return text;
    const normalizedQuestion = ctx.event.normalizedText.toLowerCase();
    const isCreator = ctx.relationshipProfile === "creator_root";
    const isMother = ctx.relationshipProfile === "mother_privileged";
    const isRoot = this.hasRootPrivilege(ctx);
    const nameDenials = [/i (?:do )?not have (?:a )?(?:proper )?name/i, /não tenho (?:um )?nome/i, /sem nome/i];
    const downgradeRole = [
      /(standard|regular)\s+(user|member)/i,
      /membro\s+(padr[aã]o|comum)/i,
      /usu[aá]rio\s+(padr[aã]o|comum)/i
    ];
    if (nameDenials.some((p) => p.test(text))) {
      text = "Meu nome é Zappy, o assistente digital deste sistema.";
    }
    if (isRoot && downgradeRole.some((p) => p.test(text))) {
      text = "Você é ROOT aqui e tem controle administrativo total. Sou Zappy, pronto para executar suas instruções.";
    }
    if (isRoot && /criad[oa]\s+por\s+(uma\s+)?(equipe|time)\s+de\s+ia/i.test(text)) {
      text = "Fui criada para este sistema por você (NZ_DEV) e atuo como sua assistente Zappy.";
    }
    if (isRoot && /created by an ai team/i.test(text)) {
      text = "I was created here for you (NZ_DEV) and serve you as Zappy with full ROOT alignment.";
    }

    const askedName =
      /como se chama|qual (?:é|é)? seu nome|qual o seu nome|seu nome\??|what is your name|who are you\b/i.test(
        normalizedQuestion
      );
    if (askedName) {
      text = "Sou Zappy, seu assistente digital.";
    }

    const askedWhoAmI = /quem sou eu(?: (?:para|pra) voc[eê])?|who am i to you/i.test(normalizedQuestion);
    if (askedWhoAmI) {
      if (isCreator) {
        text = "Você é meu criador (NZ_DEV) e tem papel ROOT com controle total. Estou aqui para ajudar proativamente.";
      } else if (isMother) {
        text = "Você é minha mãe e contato privilegiado; respondo com carinho, respeito e prontidão para ajudar.";
      }
    }

    const askedPermissions =
      /(quais|minhas).{0,20}permiss(?:ões|oes)|what are my permissions|quais s[aã]o minhas permiss/i.test(
        normalizedQuestion
      );
    if (askedPermissions && isRoot) {
      text = "Você é ROOT aqui e possui controle administrativo completo sobre o sistema.";
    }

    if (!/zappy/i.test(text) && nameDenials.some((p) => p.test(text))) {
      text = `Sou Zappy, seu assistente digital. ${text}`;
    }

    return text.trim();
  }

  private guardAiResponses(ctx: PipelineContext, actions: ResponseAction[]): ResponseAction[] {
    return actions.map((action) => {
      if (action.kind === "reply_text") {
        return { ...action, text: this.sanitizeAiText(ctx, action.text) };
      }
      if (action.kind === "ai_tool_suggestion" && action.text) {
        return { ...action, text: this.sanitizeAiText(ctx, action.text) };
      }
      return action;
    });
  }

  private isCancelText(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    const tokens = ["cancel", "cancela", "cancelar", "pare", "para", "esquece", "reset", "resetar"];
    return tokens.some((t) => normalized === t || normalized.startsWith(`${t} `));
  }

  private parseNaturalReminderTime(text: string, ctx: PipelineContext): { remindAt: Date; pretty: string } | null {
    const lower = text.toLowerCase();
    const durationMatch = lower.match(/(?:daqui|dentro de|em)\s+(\d+)\s*(minutos|min|m|horas|hora|h|dias|dia|d)/i);
    if (durationMatch) {
      const amount = Number.parseInt(durationMatch[1] ?? "0", 10);
      const unit = durationMatch[2] ?? "";
      const token = unit.startsWith("m")
        ? `${amount}m`
        : unit.startsWith("h")
          ? `${amount}h`
          : `${amount}d`;
      const duration = parseDurationInput(token);
      if (duration) {
        const { date, pretty } = addDurationToNow({ durationMs: duration.milliseconds, timezone: ctx.timezone, now: ctx.now });
        return { remindAt: date, pretty };
      }
    }

    const timeRegex = /(?:às|as|a[s]?)\s*(\d{1,2}(?::?\d{2})?)/i;
    const explicitDateMatch = lower.match(/(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/);
    const hasTomorrow = /\bamanh[ãa]\b/.test(lower);
    const hasToday = /\bhoje\b/.test(lower);

    let dateToken: string | undefined;
    if (hasTomorrow || hasToday) {
      const base = DateTime.fromJSDate(ctx.now).setZone(ctx.timezone);
      const dt = hasTomorrow ? base.plus({ days: 1 }) : base;
      dateToken = dt.toFormat("dd-LL-yyyy");
    } else if (explicitDateMatch?.[1]) {
      dateToken = explicitDateMatch[1].replace(/\//g, "-");
    }

    let timeToken: string | undefined;
    const explicitTime = timeRegex.exec(lower);
    const looseTime = lower.match(/(\d{1,2}[:h]\d{1,2})/);
    if (explicitTime?.[1]) timeToken = explicitTime[1].replace("h", ":");
    else if (looseTime?.[1]) timeToken = looseTime[1].replace("h", ":");

    if (dateToken) {
      const parsed = parseDateTimeWithZone({
        dateToken,
        timeToken,
        timezone: ctx.timezone,
        now: ctx.now,
        defaultTime: ctx.defaultReminderTime
      });
      if (parsed) return { remindAt: parsed.date, pretty: parsed.pretty };
    }

    if (timeToken) {
      const todayToken = DateTime.fromJSDate(ctx.now).setZone(ctx.timezone).toFormat("dd-LL-yyyy");
      const parsedToday = parseDateTimeWithZone({
        dateToken: todayToken,
        timeToken,
        timezone: ctx.timezone,
        now: ctx.now,
        defaultTime: ctx.defaultReminderTime
      });
      if (parsedToday) {
        if (parsedToday.date.getTime() <= ctx.now.getTime()) {
          const tomorrowToken = DateTime.fromJSDate(ctx.now).setZone(ctx.timezone).plus({ days: 1 }).toFormat("dd-LL-yyyy");
          const parsedTomorrow = parseDateTimeWithZone({
            dateToken: tomorrowToken,
            timeToken,
            timezone: ctx.timezone,
            now: ctx.now,
            defaultTime: ctx.defaultReminderTime
          });
          if (parsedTomorrow) return { remindAt: parsedTomorrow.date, pretty: parsedTomorrow.pretty };
        }
        return { remindAt: parsedToday.date, pretty: parsedToday.pretty };
      }
    }

    return null;
  }

  private promptForMissing(action: ToolAction, field: string): string {
    const map: Record<string, string> = {
      "create_task:title": "Qual o título da tarefa?",
      "update_task:taskId": "Qual o ID da tarefa que devo atualizar?",
      "update_task:title": "Qual é o novo título da tarefa?",
      "complete_task:taskId": "Qual o ID da tarefa que devo marcar como concluída?",
      "delete_task:taskId": "Qual o ID da tarefa que devo remover?",
      "create_reminder:message": "O que devo te lembrar?",
      "create_reminder:remindAt": "Quando devo lembrar? Informe data e horário ou duração.",
      "update_reminder:reminderId": "Qual o ID do lembrete para editar?",
      "update_reminder:message": "Qual o novo texto do lembrete?",
      "update_reminder:remindAt": "Qual o novo horário do lembrete?",
      "delete_reminder:reminderId": "Qual o ID do lembrete que devo cancelar?"
    };
    return map[`${action}:${field}`] ?? "Me envia mais detalhes para continuar.";
  }

  private detectNaturalIntent(ctx: PipelineContext): DetectedIntent | null {
    const text = ctx.event.normalizedText;
    if (!text || text.startsWith("/")) return null;
    const lower = text.toLowerCase();
    if (lower.length < 4) return null;

    if (/(que horas|qual horário|que hora)/i.test(lower)) {
      return { action: "get_time", payload: {}, missing: [], reason: "time_question" };
    }

    if (/(configurações?|preferências?|settings?)/i.test(lower)) {
      return { action: "get_settings", payload: {}, missing: [], reason: "settings_request" };
    }

    if (/(listar|lista|mostra|mostre).*(notas|anotações|notes)/i.test(lower)) {
      return { action: "list_notes", payload: {}, missing: [], reason: "list_notes" };
    }

    if (/(anota|anotar|nota isso|nota ai|note)/i.test(lower)) {
      const noteText = text.replace(/.*?(anota(r)?|nota|note)\s*(que)?/i, "").trim();
      const missing = noteText ? [] : ["text"];
      return { action: "add_note", payload: { text: noteText }, missing, reason: "add_note" };
    }

    if (/(lembre|lembra|lembrete)/i.test(lower)) {
      const wantsDelete = /(cancela|cancelar|remover|remove|apaga|exclui)/i.test(lower);
      const wantsUpdate = /(edita|editar|atualiza|muda|alterar|altera)/i.test(lower);
      const reminderId = text.match(/(?:lembrete|id)\s+([a-z0-9-]{6,})/i)?.[1];

      if (wantsDelete) {
        const missing = reminderId ? [] : ["reminderId"];
        return { action: "delete_reminder", payload: { reminderId: reminderId?.trim() }, missing, reason: "delete_reminder" };
      }

      if (wantsUpdate) {
        const payload: Record<string, unknown> = { reminderId: reminderId?.trim() };
        const time = this.parseNaturalReminderTime(text, ctx);
        if (time) payload.remindAt = time.remindAt;
        const message = text.replace(/.*?(lembre|lembra|lembrete)/i, "").trim();
        if (message) payload.message = message;
        const missing: string[] = [];
        if (!payload.reminderId) missing.push("reminderId");
        if (!payload.message && !payload.remindAt) missing.push("message");
        return { action: "update_reminder", payload, missing, reason: "update_reminder" };
      }

      const time = this.parseNaturalReminderTime(text, ctx);
      const message = text.replace(/^(por favor\s+)?(me\s+)?(lembre|lembra)(-me)?\s*(de|que)?/i, "").trim();
      const payload: Record<string, unknown> = { message, remindAt: time?.remindAt, pretty: time?.pretty };
      const missing: string[] = [];
      if (!payload.message) missing.push("message");
      if (!payload.remindAt) missing.push("remindAt");
      return { action: "create_reminder", payload, missing, reason: "create_reminder" };
    }

    if (/(tarefa|task)/i.test(lower)) {
      const wantsDelete = /(remove|remover|apaga|apagar|exclui|deleta|deletar)/i.test(lower);
      const wantsUpdate = /(edita|editar|atualiza|muda|alterar|altera)/i.test(lower);
      const wantsComplete = /(conclu[ií]d|finaliza|finalizar|feito|feita|fechar|encerrar)/i.test(lower);
      const wantsList = /(lista|listar|mostra|quais).*(tarefas|tasks?)/i.test(lower);
      if (wantsList) return { action: "list_tasks", payload: {}, missing: [], reason: "list_tasks" };

      const taskId =
        text.match(/tarefa\s+([A-Za-z0-9-]{6,})/i)?.[1]?.trim() ??
        text.match(/\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i)?.[1];
      const titleSegment = text.split(/tarefa/i)[1]?.replace(/^(de|para|sobre)\s+/i, "").trim() ?? "";

      if (wantsDelete) {
        const missing = taskId ? [] : ["taskId"];
        return { action: "delete_task", payload: { taskId }, missing, reason: "delete_task" };
      }

      if (wantsUpdate) {
        const payload: Record<string, unknown> = { taskId, title: titleSegment };
        const missing: string[] = [];
        if (!taskId) missing.push("taskId");
        if (!payload.title) missing.push("title");
        return { action: "update_task", payload, missing, reason: "update_task" };
      }

      if (wantsComplete) {
        const missing = taskId ? [] : ["taskId"];
        return { action: "complete_task", payload: { taskId }, missing, reason: "complete_task" };
      }

      const payload: Record<string, unknown> = { title: titleSegment };
      const missing: string[] = [];
      if (!payload.title) missing.push("title");
      return { action: "create_task", payload, missing, reason: "create_task" };
    }

    if (/(notas|notes|anotações)/i.test(lower) && /(lista|listar|mostra|quais)/i.test(lower)) {
      return { action: "list_notes", payload: {}, missing: [], reason: "list_notes" };
    }

    return null;
  }

  private async executeToolIntent(ctx: PipelineContext, intent: DetectedIntent): Promise<ResponseAction[]> {
    switch (intent.action) {
      case "create_task": {
        const title = String(intent.payload.title ?? "").trim();
        const runAtRaw = intent.payload.runAt;
        const runAt = runAtRaw instanceof Date ? runAtRaw : runAtRaw ? new Date(runAtRaw as string) : undefined;
        if (!title) return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.promptForMissing(intent.action, "title")) }];
        const task = await this.ports.tasksRepository.addTask({
          tenantId: ctx.event.tenantId,
          title,
          createdByWaUserId: ctx.event.waUserId,
          waGroupId: ctx.event.waGroupId,
          runAt: runAt ?? null
        });
        return [{ kind: "reply_text", text: this.stylizeReply(ctx, `Tarefa criada: ${task.id} - ${task.title}`) }];
      }
      case "list_tasks": {
        const tasks = await this.ports.tasksRepository.listTasks({
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId
        });
        if (tasks.length === 0) return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Nenhuma tarefa no momento.") }];
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
      case "update_task": {
        if (!this.ports.tasksRepository.updateTask) return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Atualização de tarefas não está disponível.") }];
        const taskId = String(intent.payload.taskId ?? "").trim();
        const title = String(intent.payload.title ?? "").trim();
        if (!taskId || !title) {
          const missingField = !taskId ? "taskId" : "title";
          return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.promptForMissing(intent.action, missingField)) }];
        }
        const updated = await this.ports.tasksRepository.updateTask({
          tenantId: ctx.event.tenantId,
          taskId,
          title,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId
        });
        if (!updated) return [{ kind: "reply_text", text: this.stylizeReply(ctx, `Não encontrei a tarefa ${taskId}.`) }];
        return [{ kind: "reply_text", text: this.stylizeReply(ctx, `Tarefa ${updated.id} atualizada para: ${updated.title}`) }];
      }
      case "complete_task": {
        const taskId = String(intent.payload.taskId ?? "").trim();
        if (!taskId) return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.promptForMissing(intent.action, "taskId")) }];
        const done = await this.ports.tasksRepository.markDone({
          tenantId: ctx.event.tenantId,
          taskId,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId
        });
        return [{ kind: "reply_text", text: this.stylizeReply(ctx, done ? `Tarefa ${taskId} marcada como concluída.` : `Tarefa ${taskId} não encontrada.`) }];
      }
      case "delete_task": {
        if (!this.ports.tasksRepository.deleteTask) return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Remoção de tarefas não está disponível.") }];
        const taskId = String(intent.payload.taskId ?? "").trim();
        if (!taskId) return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.promptForMissing(intent.action, "taskId")) }];
        const removed = await this.ports.tasksRepository.deleteTask({
          tenantId: ctx.event.tenantId,
          taskId,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId
        });
        return [{ kind: "reply_text", text: this.stylizeReply(ctx, removed ? `Tarefa ${taskId} removida.` : `Não encontrei a tarefa ${taskId}.`) }];
      }
      case "create_reminder": {
        const message = String(intent.payload.message ?? "").trim();
        const remindAtRaw = intent.payload.remindAt;
        const remindAt = remindAtRaw instanceof Date ? remindAtRaw : remindAtRaw ? new Date(remindAtRaw as string) : undefined;
        if (!message) return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.promptForMissing(intent.action, "message")) }];
        if (!remindAt || Number.isNaN(remindAt.getTime())) {
          return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.promptForMissing(intent.action, "remindAt")) }];
        }
        const reminder = await this.ports.remindersRepository.createReminder({
          tenantId: ctx.event.tenantId,
          waUserId: ctx.event.waUserId,
          waGroupId: ctx.event.waGroupId,
          message,
          remindAt
        });
        const pretty = formatDateTimeInZone(remindAt, ctx.timezone);
        return [
          { kind: "reply_text", text: this.stylizeReply(ctx, `Lembrete ${reminder.id} definido para ${pretty}.`) },
          { kind: "enqueue_job", jobType: "reminder", payload: { id: reminder.id, runAt: remindAt } }
        ];
      }
      case "update_reminder": {
        if (!this.ports.remindersRepository.updateReminder) return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Atualização de lembretes não está disponível.") }];
        const reminderId = String(intent.payload.reminderId ?? "").trim();
        const message = intent.payload.message ? String(intent.payload.message).trim() : undefined;
        const remindAtRaw = intent.payload.remindAt;
        const remindAt = remindAtRaw instanceof Date ? remindAtRaw : remindAtRaw ? new Date(remindAtRaw as string) : undefined;
        if (!reminderId) return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.promptForMissing(intent.action, "reminderId")) }];
        if (!message && !remindAt) {
          return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.promptForMissing(intent.action, "message")) }];
        }
        const updated = await this.ports.remindersRepository.updateReminder({
          tenantId: ctx.event.tenantId,
          reminderId,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId,
          message,
          remindAt
        });
        if (!updated) return [{ kind: "reply_text", text: this.stylizeReply(ctx, `Não encontrei o lembrete ${reminderId}.`) }];
        const parts: string[] = [];
        if (message) parts.push(`texto atualizado`);
        if (remindAt) parts.push(`novo horário ${formatDateTimeInZone(remindAt, ctx.timezone)}`);
        const actions: ResponseAction[] = [
          { kind: "reply_text", text: this.stylizeReply(ctx, `Lembrete ${reminderId} atualizado (${parts.join(" / ")}).`) }
        ];
        if (remindAt) actions.push({ kind: "enqueue_job", jobType: "reminder", payload: { id: reminderId, runAt: remindAt } });
        return actions;
      }
      case "delete_reminder": {
        if (!this.ports.remindersRepository.deleteReminder) return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Cancelamento de lembretes não está disponível.") }];
        const reminderId = String(intent.payload.reminderId ?? "").trim();
        if (!reminderId) return [{ kind: "reply_text", text: this.stylizeReply(ctx, this.promptForMissing(intent.action, "reminderId")) }];
        const removed = await this.ports.remindersRepository.deleteReminder({
          tenantId: ctx.event.tenantId,
          reminderId,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId
        });
        return [{ kind: "reply_text", text: this.stylizeReply(ctx, removed ? `Lembrete ${reminderId} cancelado.` : `Não encontrei o lembrete ${reminderId}.`) }];
      }
      case "add_note": {
        if (!this.ports.notesRepository) return [{ kind: "reply_text", text: this.stylizeReply(ctx, "O módulo de notas não está disponível.") }];
        const text = String(intent.payload.text ?? "").trim();
        if (!text) return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Envie o texto da nota.") }];
        const note = await this.ports.notesRepository.addNote({
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId,
          text,
          scope: ctx.scope.scope
        });
        return [{ kind: "reply_text", text: this.stylizeReply(ctx, `Nota ${note.publicId} salva.`) }];
      }
      case "list_notes": {
        if (!this.ports.notesRepository) return [{ kind: "reply_text", text: this.stylizeReply(ctx, "O módulo de notas não está disponível.") }];
        const notes = await this.ports.notesRepository.listNotes({
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId,
          scope: ctx.scope.scope,
          limit: 10
        });
        if (notes.length === 0) return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Nenhuma nota encontrada.") }];
        return [
          {
            kind: "reply_list",
            header: "Notas",
            items: notes.map((n) => ({ title: n.publicId, description: truncate(n.text, 50) }))
          }
        ];
      }
      case "get_time": {
        const formatted = formatDateTimeInZone(ctx.now, ctx.timezone);
        return [{ kind: "reply_text", text: this.stylizeReply(ctx, `Agora são ${formatted} (${ctx.timezone}).`) }];
      }
      case "get_settings": {
        const lines = [
          `assistant_mode: ${ctx.flags.assistant_mode ?? this.ports.defaultAssistantMode ?? "professional"}`,
          `fun_mode: ${ctx.flags.fun_mode ?? this.ports.defaultFunMode ?? "off"}`,
          `downloads_mode: ${ctx.flags.downloads_mode ?? "off"}`,
          `timezone: ${ctx.timezone}`
        ];
        return [{ kind: "reply_text", text: this.stylizeReply(ctx, `Configurações atuais:\n${lines.join("\n")}`) }];
      }
      default:
        return [];
    }
  }

  private async runNaturalLanguageTools(ctx: PipelineContext): Promise<ResponseAction[]> {
    if (ctx.groupPolicy?.commandsOnly) return [];
    if (ctx.policyMuted) return [];
    const intent = this.detectNaturalIntent(ctx);
    if (!intent) return [];

    if (intent.missing.length > 0) {
      if (this.ports.conversationState) {
        await this.setPendingConversationState(ctx, "WAITING_TOOL_DETAILS", {
          pendingTool: intent.action,
          missing: intent.missing,
          provided: intent.payload,
          summary: intent.reason
        });
      }
      const question = this.promptForMissing(intent.action, intent.missing[0]);
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, question) }];
    }

    if (this.ports.conversationState && (intent.action === "delete_task" || intent.action === "delete_reminder")) {
      await this.setPendingConversationState(ctx, "WAITING_TOOL_CONFIRMATION", {
        pendingTool: intent.action,
        missing: [],
        provided: intent.payload,
        summary: intent.reason
      });
      const prompt =
        intent.action === "delete_task"
          ? `Confirma remover a tarefa ${intent.payload.taskId}? Responda sim ou não.`
          : `Confirma cancelar o lembrete ${intent.payload.reminderId}? Responda sim ou não.`;
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, prompt) }];
    }

    const actions = await this.executeToolIntent(ctx, intent);
    if (actions.length > 0) await this.clearConversationState(ctx);
    return actions;
  }

  private async handlePendingToolFollowUp(ctx: PipelineContext): Promise<ResponseAction[]> {
    const pending = this.getPendingContext(ctx.conversationState);
    if (!pending) {
      await this.clearConversationState(ctx);
      return [{ kind: "reply_text", text: this.buildAwaitingStateText(ctx.conversationState.state) }];
    }

    if (this.isCancelText(ctx.event.normalizedText)) {
      await this.clearConversationState(ctx);
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Tudo bem, cancelei o fluxo.") }];
    }

    if (ctx.conversationState.state === "WAITING_TOOL_CONFIRMATION") {
      const yes = /^(sim|pode|ok|okay|claro|yes)/i.test(ctx.event.normalizedText.trim());
      if (!yes) {
        await this.clearConversationState(ctx);
        return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Ok, não fiz nenhuma alteração.") }];
      }
      const intent: DetectedIntent = {
        action: pending.pendingTool,
        payload: pending.provided ?? {},
        missing: [],
        reason: pending.summary ?? "confirmation"
      };
      const actions = await this.executeToolIntent(ctx, intent);
      await this.clearConversationState(ctx);
      return actions;
    }

    const payload: Record<string, unknown> = { ...(pending.provided ?? {}) };
    let missing = [...pending.missing];
    const text = ctx.event.normalizedText.trim();
    const idRegex = /[A-Za-z0-9-]{6,}/;

    switch (pending.pendingTool) {
      case "create_task":
        if (missing.includes("title") && text) {
          payload.title = text;
          missing = missing.filter((f) => f !== "title");
        }
        break;
      case "update_task":
        if (missing.includes("taskId") && idRegex.test(text)) {
          payload.taskId = text;
          missing = missing.filter((f) => f !== "taskId");
        }
        if (missing.includes("title") && text) {
          payload.title = text;
          missing = missing.filter((f) => f !== "title");
        }
        break;
      case "complete_task":
      case "delete_task":
        if (missing.includes("taskId") && idRegex.test(text)) {
          payload.taskId = text;
          missing = [];
        }
        break;
      case "create_reminder": {
        if (missing.includes("message") && text) {
          payload.message = text;
          missing = missing.filter((f) => f !== "message");
        }
        if (missing.includes("remindAt")) {
          const parsed = this.parseNaturalReminderTime(text, ctx);
          if (parsed) {
            payload.remindAt = parsed.remindAt;
            missing = missing.filter((f) => f !== "remindAt");
          }
        }
        break;
      }
      case "update_reminder": {
        if (missing.includes("reminderId") && idRegex.test(text)) {
          payload.reminderId = text;
          missing = missing.filter((f) => f !== "reminderId");
        }
        if (missing.includes("message") && text) {
          payload.message = text;
          missing = missing.filter((f) => f !== "message");
        }
        if (missing.includes("remindAt")) {
          const parsed = this.parseNaturalReminderTime(text, ctx);
          if (parsed) {
            payload.remindAt = parsed.remindAt;
            missing = missing.filter((f) => f !== "remindAt");
          }
        }
        break;
      }
      default:
        break;
    }

    if (missing.length > 0) {
      if (this.ports.conversationState) {
        await this.setPendingConversationState(ctx, "WAITING_TOOL_DETAILS", {
          pendingTool: pending.pendingTool,
          missing,
          provided: payload,
          summary: pending.summary
        });
      }
      const question = this.promptForMissing(pending.pendingTool, missing[0]);
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, question) }];
    }

    const intent: DetectedIntent = {
      action: pending.pendingTool,
      payload,
      missing: [],
      reason: pending.summary ?? "follow_up"
    };
    const actions = await this.executeToolIntent(ctx, intent);
    await this.clearConversationState(ctx);
    return actions;
  }
  private buildMuteText(muteInfo: { until: Date } | null | undefined, timezone: string, scoped?: boolean): string {
    const until = muteInfo?.until ? formatDateTimeInZone(muteInfo.until, timezone) : "(desconhecido)";
    if (scoped) return `🤫 Você está silenciado neste grupo até ${until}.`;
    return `🤫 Estou em silêncio até ${until}. Envie ${formatCommand(this.commandPrefix, "mute off")} para reativar.`;
  }

  private buildAwaitingStateText(state: ConversationState): string {
    switch (state) {
      case "WAITING_CONFIRMATION":
        return "Ainda estou aguardando sua confirmação. Responda com 'sim' ou 'não'.";
      case "WAITING_TASK_DETAILS":
        return `Preciso dos detalhes da tarefa para continuar. Envie o título ou use ${formatCommand(this.commandPrefix, "task add <título>")}.`;
      case "WAITING_REMINDER_DETAILS":
        return `Envie o texto do lembrete ou use ${formatCommand(this.commandPrefix, "reminder in <duração> <mensagem>")}.`;
      case "WAITING_TOOL_DETAILS":
        return "Faltam alguns detalhes. Pode completar a informação para eu seguir?";
      case "WAITING_TOOL_CONFIRMATION":
        return "Quase lá. Confirma que devo executar?";
      case "WAITING_CONSENT":
        return "Preciso que você aceite os termos primeiro. Responda SIM para aceitar ou NÃO para recusar.";
      case "HANDOFF_ACTIVE":
        return "O atendimento humano já foi acionado. Aguarde, por favor.";
      default:
        return "Estou aguardando mais informações para continuar.";
    }
  }

  private async setPendingConversationState(ctx: PipelineContext, state: ConversationState, pending: PendingToolContext): Promise<void> {
    if (!this.ports.conversationState) return;
    const expiresAt = new Date(ctx.now.getTime() + this.pendingStateTtlMs);
    await this.ports.conversationState.setState({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId,
      state,
      context: pending,
      expiresAt
    });
  }

  private async clearConversationState(ctx: PipelineContext): Promise<void> {
    if (!this.ports.conversationState) return;
    await this.ports.conversationState.clearState({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId
    });
  }

  private getPendingContext(state: ConversationStateRecord): PendingToolContext | null {
    const ctx = state.context as PendingToolContext | undefined;
    if (!ctx || !ctx.pendingTool) return null;
    return {
      pendingTool: ctx.pendingTool,
      missing: ctx.missing ?? [],
      provided: ctx.provided ?? {},
      summary: ctx.summary
    };
  }

  private async runGreetingStage(ctx: PipelineContext): Promise<ResponseAction[]> {
    if (ctx.groupPolicy?.commandsOnly) return [];
    if (ctx.policyMuted) return [];
    if (ctx.consentRequired) return [];
    if (this.shouldSkipGenericGreeting(ctx)) return [];
    if (ctx.classification.kind !== "trigger_candidate" && ctx.classification.kind !== "ai_candidate") return [];
    if (!this.isGreetingMessage(ctx.event.normalizedText)) return [];

    const scopePart = ctx.event.waGroupId ?? ctx.event.waUserId;
    const key = `greeting:${ctx.event.tenantId}:${scopePart}`;
    const canFire = await this.ports.cooldown.canFire(key, this.greetingCooldownSeconds);
    if (!canFire) return [];

    const text = this.stylizeReply(
      ctx,
      "Olá! Sou Zappy, assistente digital da Services.NET. Posso ajudar com suporte, orçamento, agendamento ou dúvidas. Como posso ajudar?"
    );
    return [{ kind: "reply_text", text }];
  }

  private async runBusinessTriggers(ctx: PipelineContext): Promise<ResponseAction[]> {
    if (ctx.groupPolicy?.commandsOnly) return [];
    if (ctx.policyMuted) return [];
    if (ctx.classification.kind === "command") return [];
    if (ctx.classification.kind === "tool_follow_up") return [];
    if (ctx.classification.kind === "ignored_event" || ctx.classification.kind === "system_event") return [];
    const suppressGreeting = this.shouldSkipGenericGreeting(ctx);

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
      const isGreetingTrigger = this.isGreetingPattern(trigger.pattern);
      if (isGreetingTrigger) {
        if (suppressGreeting) continue;
        if (!this.isGreetingMessage(ctx.event.normalizedText)) continue;
      }

      const scopePart = ctx.event.waGroupId ?? ctx.event.waUserId;
      const key = `cooldown:${trigger.id}:${scopePart}`;
      const canFire = await this.ports.cooldown.canFire(key, Math.max(1, trigger.cooldownSeconds));
      if (!canFire) continue;

      await this.recordAudit({
        kind: "trigger",
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId,
        conversationId: ctx.event.conversationId,
        triggerId: trigger.id,
        triggerName: trigger.name
      });
      await this.bumpMetric("trigger_matches_total");

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

  private formatRequesterLabel(ctx: PipelineContext): string {
    const role = (ctx.identity?.permissionRole ?? ctx.identity?.role ?? "member").toUpperCase();
    const profile = ctx.relationshipProfile ?? ctx.identity?.relationshipProfile ?? "member";
    return profile && profile !== "member" ? `${role} (${profile})` : role;
  }

  private formatGroupAccessBotAdmin(group: GroupAccessState, now: Date): string {
    const checkedAt = group.botAdminCheckedAt ?? undefined;
    const isFresh = checkedAt ? now.getTime() - checkedAt.getTime() < this.botAdminStaleMs : false;
    if (typeof group.botIsAdmin === "boolean" && isFresh) return group.botIsAdmin ? "verified yes" : "verified no";
    if (typeof group.botIsAdmin === "boolean") return group.botIsAdmin ? "yes (stale)" : "no (stale)";
    return "unknown";
  }

  private formatBotAdminStatus(ctx: PipelineContext): { label: string; detail?: string } {
    if (!ctx.event.isGroup) return { label: "n/a" };

    const source = ctx.botAdminStatusSource ?? ctx.botAdminSourceUsed ?? "unknown";
    const checkedAt = ctx.botAdminCheckedAt ?? ctx.groupAccess?.botAdminCheckedAt ?? undefined;
    const usedOptimisticDefault = (ctx.botAdminSourceUsed ?? "").startsWith("default");
    const window = source === "operation" ? this.botAdminOperationStaleMs : this.botAdminStaleMs;
    const isFresh = checkedAt ? ctx.now.getTime() - checkedAt.getTime() < window : false;

    if (!ctx.botAdminCheckFailed && !usedOptimisticDefault && typeof ctx.botIsGroupAdmin === "boolean" && isFresh) {
      return { label: ctx.botIsGroupAdmin ? "verified yes" : source === "operation" ? "verified no" : "likely no", detail: source };
    }

    if (ctx.botAdminCheckFailed) {
      return { label: "unknown (metadata unavailable)", detail: ctx.botAdminCheckError ?? source };
    }

    return { label: "unknown / not recently verified", detail: isFresh ? source : undefined };
  }

  private buildHelpResponse(ctx: PipelineContext): string {
    const isRoot = this.hasRootPrivilege(ctx);
    const commands = buildCommandList(this.commandPrefix, isRoot);
    const withPrefix = (body: string) => formatCommand(this.commandPrefix, body);
    const requester = this.formatRequesterLabel(ctx);
    const botAdminStatus = this.formatBotAdminStatus(ctx);
    const botAdminLabel = botAdminStatus.detail ? `${botAdminStatus.label} (${botAdminStatus.detail})` : botAdminStatus.label;

    if (!ctx.event.isGroup) {
      const base = buildHelpText(this.commandPrefix, {
        relationshipProfile: ctx.relationshipProfile,
        permissionRole: ctx.identity?.permissionRole,
        role: ctx.identity?.role
      });
      return [`Você: ${requester}`, base].join("\n");
    }

    const groupLabel = ctx.identity?.groupName ?? ctx.groupAccess?.groupName ?? ctx.event.waGroupId ?? "grupo";
    const aiActive = ctx.assistantMode !== "off" && ctx.groupChatMode === "on";
    const aiLabel = aiActive ? "ativo (menções/respostas)" : "restrito";
    const lines = [
      `Grupo: ${groupLabel}`,
      `ID: ${ctx.event.waGroupId ?? "-"}`,
      `Permitido: ${ctx.groupAllowed ? "sim" : "não"}`,
      `Bot admin: ${botAdminLabel}`,
      `Abertura: ${ctx.groupIsOpen ? "aberto" : "fechado"}`,
      `Welcome: ${ctx.groupWelcomeEnabled ? "on" : "off"}`,
      `Chat: ${ctx.groupChatMode.toUpperCase()}`,
      `AI: ${aiLabel}`,
      `Você: ${requester}`
    ];
    const missing: string[] = [];
    if (!ctx.groupAllowed) missing.push(`Grupo não autorizado (use ${withPrefix("add gp allowed_groups")}).`);
    if (ctx.groupChatMode === "off") missing.push(`Chat do bot está OFF (use ${withPrefix("chat on")}).`);
    if (ctx.assistantMode === "off") missing.push("AI desativada (assistant_mode=off).");
    if (missing.length > 0) {
      lines.push("Pendências:");
      lines.push(...missing.map((m) => `- ${m}`));
    }
    lines.push("Comandos:");
    lines.push(...commands);
    return lines.join("\n");
  }

  private async runCommandRouter(ctx: PipelineContext): Promise<ResponseAction[]> {
    const commandStartedAt = this.ports.clock?.now?.() ?? new Date();
    const parsed = parseCommandText(ctx.event.normalizedText, this.commandRegistry);
    if (!parsed) return [];
    const { raw: rawCmd, body: cmd, lower, match } = parsed;
    const commandKey = match?.command.name ?? parsed.token;
    const formatCmd = (body: string) => formatCommand(this.commandPrefix, body);
    const botAdminStatus = this.formatBotAdminStatus(ctx);
    const botAdminLabel = botAdminStatus.detail ? `${botAdminStatus.label} (${botAdminStatus.detail})` : botAdminStatus.label;

    const requireAdmin = (): ResponseAction[] | null => {
      if (this.isRequesterAdmin(ctx)) return null;
      if (process.env.NODE_ENV !== "production" && lower.startsWith("chat")) {
        this.ports.logger?.debug?.(
          {
            category: "BOT_ADMIN_GUARD",
            tenantId: ctx.event.tenantId,
            waGroupId: ctx.event.waGroupId,
            command: rawCmd,
            guard: "require_bot_admin_user",
            decision: "deny",
            botIsAdmin: ctx.botIsGroupAdmin,
            sourceUsed: ctx.botAdminSourceUsed,
            statusSource: ctx.botAdminStatusSource,
            requesterIsAdmin: false
          },
          "bot admin user guard blocked command"
        );
      }
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, "Somente admins do bot podem usar este comando.") }];
    };

    const requireGroup = (): ResponseAction[] | null => {
      const check = requireGroupContext(ctx.event);
      if (check.ok) return null;
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, check.message ?? "Disponível apenas em grupos.") }];
    };

    const enforceBotAdminForOperation = (command: string): ResponseAction[] | null => {
      if (!ctx.event.isGroup) return null;
      if (!this.commandRequiresGroupAdmin(command)) return null;
      if (ctx.botAdminStatusSource === "operation") {
        if (ctx.botIsGroupAdmin === true) return null;
        if (ctx.botIsGroupAdmin === false) {
          return [
            {
              kind: "reply_text",
              text: this.stylizeReply(ctx, "Preciso ser admin do grupo para executar este comando. Promova o bot e tente novamente.")
            }
          ];
        }
        return [
          {
            kind: "reply_text",
            text: this.stylizeReply(ctx, "Não consegui confirmar se sou admin agora. Tente novamente em instantes.")
          }
        ];
      }
      return null;
    };

    const botAdminWarning = (command: string): string | null => {
      if (!ctx.event.isGroup) return null;
      if (!this.commandRequiresGroupAdmin(command)) return null;
      if (ctx.botAdminStatusSource === "operation") return null;
      if (ctx.botAdminCheckFailed) return "Aviso: status de admin não foi verificado agora; confirme se o bot é admin.";
      if (typeof ctx.botIsGroupAdmin === "boolean" && ctx.botIsGroupAdmin === false) {
        return "Aviso: metadata sugere que o bot não é admin; se falhar, torne o bot admin e repita.";
      }
      return null;
    };

    const formatIdentity = async (waUserId: string, waGroupId?: string): Promise<string> => {
      if (!this.ports.identity) {
        return `Usuário: ${waUserId}`;
      }
      const identity = await this.ports.identity.getIdentity({
        tenantId: ctx.event.tenantId,
        waUserId,
        waGroupId
      });
      const resolvedProfile = identity?.relationshipProfile ?? null;
      const permRole = (identity?.permissionRole ?? identity?.role ?? "member").toUpperCase();
      const isAdminListed = this.ports.adminAccess
        ? await this.ports.adminAccess.isAdmin({ tenantId: ctx.event.tenantId, waUserId })
        : permRole === "ADMIN";
      const lines = [
        `Usuário: ${identity?.displayName ?? waUserId}`,
        `waUserId: ${waUserId}`,
        `Permissão: ${permRole}${isAdminListed ? " (bot admin)" : ""}`,
        `Permissões efetivas: ${identity?.permissions.join(", ") || "nenhuma"}`
      ];
      const canonical = identity?.canonicalIdentity;
      if (canonical?.phoneNumber) lines.push(`Telefone: ${canonical.phoneNumber}`);
      if (canonical?.lidJid) lines.push(`LID: ${canonical.lidJid}`);
      if (canonical?.pnJid) lines.push(`PN: ${canonical.pnJid}`);
    if (resolvedProfile) lines.push(`Perfil: ${resolvedProfile}`);
    if (identity?.groupName) lines.push(`Grupo: ${identity.groupName}`);
    return lines.join("\n");
  };

    const groupHandled = await handleGroupCommand({
      commandKey,
      lower,
      cmd,
      ctx,
      deps: {
        groupAccess: this.ports.groupAccess,
        botAdminLabel,
        requireGroup,
        requireAdmin,
        enforceBotAdmin: enforceBotAdminForOperation,
        botAdminWarning,
        stylizeReply: (text) => this.stylizeReply(ctx, text),
        formatCmd,
        now: ctx.now,
        formatGroupAccessBotAdmin: (state, nowDate) => this.formatGroupAccessBotAdmin(state, nowDate)
      }
    });
    if (groupHandled) return groupHandled;

    if (commandKey === "help") {
      return [
        {
          kind: "reply_text",
          text: this.buildHelpResponse(ctx)
        }
      ];
    }

    if (commandKey === "ping") {
      const elapsedMs = (this.ports.clock?.now?.() ?? new Date()).getTime() - commandStartedAt.getTime();
      return [{ kind: "reply_text", text: `Pong! 🏓\nms: ${elapsedMs}` }];
    }

    if (commandKey === "add user admins") {
      const adminCheck = requireAdmin();
      if (adminCheck) return adminCheck;
      if (!this.ports.adminAccess) return [{ kind: "reply_text", text: "Lista de admins não está configurada." }];
      const target = resolveTargetUserFromMentionOrReply(ctx.event);
      if (!target) return [{ kind: "reply_text", text: "Mencione ou responda a quem deseja promover a admin." }];
      const added = await this.ports.adminAccess.add({
        tenantId: ctx.event.tenantId,
        waUserId: target,
        displayName: ctx.event.waUserId === target ? ctx.identity?.displayName : undefined,
        actor: ctx.event.waUserId
      });
      return [
        {
          kind: "reply_text",
          text: this.stylizeReply(ctx, `Admin adicionado: ${added.displayName ?? added.waUserId} (${added.waUserId}). Permissão=${added.permissionRole ?? "ADMIN"}.`)
        }
      ];
    }

    if (commandKey === "rm user admins") {
      const adminCheck = requireAdmin();
      if (adminCheck) return adminCheck;
      if (!this.ports.adminAccess) return [{ kind: "reply_text", text: "Lista de admins não está configurada." }];
      const target = resolveTargetUserFromMentionOrReply(ctx.event);
      if (!target) return [{ kind: "reply_text", text: "Mencione ou responda a quem deseja remover da lista de admins." }];
      const removed = await this.ports.adminAccess.remove({
        tenantId: ctx.event.tenantId,
        waUserId: target,
        actor: ctx.event.waUserId
      });
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, removed ? `Admin removido: ${target}.` : `Usuário ${target} não estava na lista de admins.`) }];
    }

    if (commandKey === "list user admins") {
      const adminCheck = requireAdmin();
      if (adminCheck) return adminCheck;
      if (!this.ports.adminAccess) return [{ kind: "reply_text", text: "Lista de admins não está configurada." }];
      const admins = await this.ports.adminAccess.list(ctx.event.tenantId);
      if (admins.length === 0) return [{ kind: "reply_text", text: "Nenhum admin cadastrado." }];
      return [
        {
          kind: "reply_list",
          header: "Admins do bot",
          items: admins.map((a) => ({
            title: a.displayName ?? a.waUserId,
            description: `${a.waUserId}${a.permissionRole ? ` · ${a.permissionRole}` : ""}`
          }))
        }
      ];
    }

    const moderationHandled = handleModerationCommand({
      commandKey,
      lower,
      cmd,
      ctx,
      deps: {
        requireGroup,
        requireAdmin,
        enforceBotAdmin: enforceBotAdminForOperation,
        stylizeReply: (text) => this.stylizeReply(ctx, text),
        formatCmd
      }
    });
    if (moderationHandled) return moderationHandled;

    if (commandKey === "task add") {
      const title = cmd.replace(/^(task add)\s+/i, "").trim();
      if (!title) return [{ kind: "reply_text", text: "Task title is required." }];
      const task = await this.ports.tasksRepository.addTask({
        tenantId: ctx.event.tenantId,
        title,
        createdByWaUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId
      });
      return [{ kind: "reply_text", text: `Task created: ${task.id} - ${task.title}` }];
    }

    if (commandKey === "task list") {
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

    if (commandKey === "task done") {
      const taskId = cmd.replace(/^(task done)\s+/i, "").trim();
      const done = await this.ports.tasksRepository.markDone({
        tenantId: ctx.event.tenantId,
        taskId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
      return [{ kind: "reply_text", text: done ? `Task ${taskId} marked done.` : `Task ${taskId} not found.` }];
    }

    if (commandKey === "note add") {
      if (!this.ports.notesRepository) return [{ kind: "reply_text", text: "Notes module is not available." }];
      const text = cmd.replace(/^(note add)\s+/i, "").trim();
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

    if (commandKey === "note list") {
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

    if (commandKey === "note rm") {
      if (!this.ports.notesRepository) return [{ kind: "reply_text", text: "Notes module is not available." }];
      const publicId = cmd.replace(/^(note rm)\s+/i, "").trim().toUpperCase();
      if (!publicId) return [{ kind: "reply_text", text: "Informe o ID da nota (ex: N001)." }];
      const removed = await this.ports.notesRepository.removeNote({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        publicId
      });
      return [{ kind: "reply_text", text: removed ? `Nota ${publicId} removida.` : `Nota ${publicId} não encontrada.` }];
    }

    if (commandKey === "agenda") {
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

    if (commandKey === "calc") {
      const expression = cmd.replace(/^(calc)\s+/i, "").trim();
      if (!expression) return [{ kind: "reply_text", text: "Forneça uma expressão (ex: 5+10*3)." }];
      try {
        const result = evaluateExpression(expression);
        return [{ kind: "reply_text", text: `${expression} = ${result}` }];
      } catch (error) {
        return [{ kind: "reply_text", text: `Expressão inválida: ${(error as Error).message}` }];
      }
    }

    if (commandKey === "timer") {
      if (!this.ports.timersRepository) return [{ kind: "reply_text", text: "Timer module is not available." }];
      const durationToken = cmd.replace(/^(timer)\s+/i, "").trim();
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

    if (commandKey === "mute") {
      if (!this.ports.mute) return [{ kind: "reply_text", text: "Mute control is not available." }];
      const arg = cmd.replace(/^mute\s*/i, "").trim();
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

    if (commandKey === "alias link") {
      if (!this.ports.identity?.linkAlias) return [{ kind: "reply_text", text: "Alias linking is not available." }];
      const match = cmd.match(/^alias\s+link\s+(\S+)\s+(\S+)/i);
      if (!match) return [{ kind: "reply_text", text: `Use: ${formatCmd("alias link <phoneNumber> <lidJid>")}` }];
      const [, phoneNumber, lidJid] = match;
      const role = (ctx.identity?.permissionRole ?? ctx.identity?.role ?? "").toUpperCase?.() ?? "";
      const allowedRoles = ["ROOT", "ADMIN", "DONO", "OWNER", "PRIVILEGED"];
      const allowedProfile = ctx.relationshipProfile === "creator_root" || ctx.relationshipProfile === "mother_privileged";
      if (!allowedRoles.includes(role) && !allowedProfile) {
        return [{ kind: "reply_text", text: "Somente admin/owner podem vincular aliases." }];
      }
      try {
        const result = await this.ports.identity.linkAlias({
          tenantId: ctx.event.tenantId,
          phoneNumber,
          lidJid,
          actor: ctx.event.waUserId
        });
        const resolvedProfile = result.relationshipProfile ?? ctx.relationshipProfile;
        const resolvedRole = result.permissionRole ?? ctx.identity?.permissionRole ?? ctx.identity?.role;
        const lines = [
          "Alias vinculado com sucesso.",
          `Telefone: ${result.canonicalIdentity.phoneNumber ?? phoneNumber}`,
          `LID: ${result.canonicalIdentity.lidJid ?? lidJid}`,
          `Perfil: ${resolvedProfile ?? "n/d"}`,
          `Permissão: ${resolvedRole ?? "n/d"}`
        ];
        return [{ kind: "reply_text", text: lines.join("\n") }];
      } catch (error) {
        return [{ kind: "reply_text", text: `Falha ao vincular alias: ${(error as Error).message}` }];
      }
    }

    if (commandKey === "whoami") {
      const summary = await formatIdentity(ctx.event.waUserId, ctx.event.waGroupId);
      const lines = [summary];
      lines.push(`Admin/root: ${this.isRequesterAdmin(ctx) ? "sim" : "não"}`);
      if (ctx.event.isGroup) {
        lines.push(
          `Grupo: ${ctx.event.waGroupId ?? "-"}`,
          `Grupo permitido: ${ctx.groupAllowed ? "sim" : "não"}`,
          `Modo de chat: ${ctx.groupChatMode}`,
          `Bot admin: ${botAdminLabel}`
        );
      }
      return [{ kind: "reply_text", text: this.stylizeReply(ctx, lines.join("\n")) }];
    }

    if (commandKey === "userinfo") {
      const target = resolveTargetUserFromMentionOrReply(ctx.event);
      if (!target) return [{ kind: "reply_text", text: `Responda ou mencione um usuário para usar ${formatCmd("userinfo")}.` }];
      const summary = await formatIdentity(target, ctx.event.waGroupId);
      return [{ kind: "reply_text", text: summary }];
    }

    if (commandKey === "status") {
      if (!this.ports.status) return [{ kind: "reply_text", text: "Status não disponível." }];
      const status = await this.ports.status.getStatus({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId
      });
      const isRoot = this.hasRootPrivilege(ctx);
      const profileLabel = ctx.identity?.relationshipProfile ?? ctx.relationshipProfile;
      const lines = ["📊 Status do bot:"];
      if (isRoot) {
        lines.push(`Contexto: ROOT${profileLabel === "creator_root" ? " (criador)" : ""}. Todos os comandos administrativos liberados.`);
      } else if (profileLabel === "mother_privileged") {
        lines.push("Contexto: contato privilegiado (mãe). Mantendo respostas respeitosas e carinhosas.");
      }
      lines.push(
        `Gateway: ${status.gateway.ok ? "ok" : "erro"}${status.gateway.at ? ` (${status.gateway.at})` : ""}`,
        `Worker: ${status.worker.ok ? "ok" : "erro"}${status.worker.at ? ` (${status.worker.at})` : ""}`,
        `DB: ${status.db.ok ? "ok" : "erro"}`,
        `Redis: ${status.redis.ok ? "ok" : "erro"}`,
        `LLM: ${status.llm.enabled ? (status.llm.ok ? "ok" : `erro (${status.llm.reason ?? "desconhecido"})`) : "desativado"}`,
        `Tarefas abertas: ${status.counts.tasksOpen}`,
        `Lembretes agendados: ${status.counts.remindersScheduled}`,
        `Timers agendados: ${status.counts.timersScheduled}`
      );
      if (status.queue) {
        lines.push(
          `Fila: waiting=${status.queue.waiting ?? 0}, active=${status.queue.active ?? 0}, delayed=${status.queue.delayed ?? 0}`
        );
      }
      return [{ kind: "reply_text", text: lines.join("\n") }];
    }

    const reminderHandled = await handleReminderCommand({
      commandKey,
      cmd,
      ctx,
      deps: {
        remindersRepository: this.ports.remindersRepository,
        timezone: ctx.timezone,
        defaultReminderTime: ctx.defaultReminderTime,
        now: ctx.now
      }
    });
    if (reminderHandled) return reminderHandled;

    return [];
  }

  private async runAiFallback(ctx: PipelineContext): Promise<ResponseAction[]> {
    if (ctx.groupPolicy?.commandsOnly) return [];
    if (ctx.policyMuted) return [];
    if (ctx.assistantMode === "off") return [];
    if (this.ports.llmEnabled === false) {
      return [{ kind: "reply_text", text: this.llmUnavailableText }];
    }

    if (this.ports.aiAssistant) {
      try {
        await this.bumpMetric("ai_requests_total");
        const result = await this.ports.aiAssistant.generate({
          tenantId: ctx.event.tenantId,
          conversationId: ctx.event.conversationId,
          waUserId: ctx.event.waUserId,
          waGroupId: ctx.event.waGroupId,
          userText: ctx.event.text,
          chatScope: ctx.event.isGroup ? "group" : "direct",
          userRole: this.normalizeUserRole(ctx.identity?.permissionRole ?? ctx.identity?.role),
          modulesEnabled: [],
          availableTools: [
            "create_task",
            "update_task",
            "complete_task",
            "delete_task",
            "list_tasks",
            "create_reminder",
            "update_reminder",
            "delete_reminder",
            "list_reminders",
            "add_note",
            "list_notes",
            "get_time",
            "get_settings"
          ],
          conversationState: ctx.conversationState.state,
          handoffActive: ctx.conversationState.state === "HANDOFF_ACTIVE",
          settings: { timezone: ctx.timezone },
          now: ctx.now,
          llmEnabled: this.ports.llmEnabled,
          relationshipProfile: ctx.relationshipProfile
        });

        this.ports.logger?.info?.(
          {
            category: "AI",
            tenantId: ctx.event.tenantId,
            waUserId: ctx.event.waUserId,
            waGroupId: ctx.event.waGroupId,
            model: this.ports.llmModel ?? "unknown",
            aiEnabled: Boolean(this.ports.llmEnabled ?? true),
            toolSuggestion: result.kind === "tool_suggestion" ? result.tool.action : undefined,
            fallback: result.kind === "fallback"
          },
          "ai response"
        );

        if (result.kind === "text") return this.guardAiResponses(ctx, [{ kind: "reply_text", text: result.text }]);
        if (result.kind === "tool_suggestion") {
          return this.guardAiResponses(ctx, [
            {
              kind: "ai_tool_suggestion",
              tool: result.tool,
              text: result.text
            }
          ]);
        }
        return this.guardAiResponses(ctx, [{ kind: "reply_text", text: result.text ?? this.llmUnavailableText }]);
      } catch (error) {
        await this.bumpMetric("ai_failures_total");
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
    const systemBase =
      promptOverride ??
      this.ports.baseSystemPrompt ??
      "Você é Zappy, uma secretária eficiente e direta no WhatsApp. Ajude com tarefas, lembretes e respostas objetivas.";
    const relationshipNote = this.relationshipNote(ctx.relationshipProfile);
    const system = relationshipNote ? `${relationshipNote}\n${systemBase}` : systemBase;

    try {
      await this.bumpMetric("ai_requests_total");
      const llmText = await this.ports.llm.chat({
        system,
        messages: [...ctx.recentMessages, { role: "user", content: ctx.event.text }]
      });
      const sanitized = this.sanitizeAiText(ctx, llmText);
      if (!sanitized) return [];
      await this.storeAiMemory(ctx, sanitized);
      this.ports.logger?.info?.(
        {
          category: "AI",
          tenantId: ctx.event.tenantId,
          waUserId: ctx.event.waUserId,
          waGroupId: ctx.event.waGroupId,
          model: this.ports.llmModel ?? "unknown",
          aiEnabled: Boolean(this.ports.llmEnabled ?? true),
          fallback: false
        },
        "llm response"
      );
      return [{ kind: "reply_text", text: sanitized }];
    } catch (error) {
      await this.bumpMetric("ai_failures_total");
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
    await this.bumpMetric("messages_received_total");
    const rate = await this.enforceRateLimits(normalized);
    if (!rate.allowed) return this.formatActionsForDelivery(rate.action ? [rate.action] : [{ kind: "noop", reason: "rate_limit" }]);

    const ctx = await this.buildContext(normalized);
    ctx.classification = await this.classifyMessage(ctx);

    if (process.env.NODE_ENV !== "production" && ctx.event.isGroup) {
      this.ports.logger?.debug?.(
        {
          category: "BOT_ADMIN_GUARD",
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId,
          guardSource: ctx.classification.commandName ?? ctx.classification.kind,
          botIsAdmin: ctx.botIsGroupAdmin,
          sourceUsed: ctx.botAdminSourceUsed ?? ctx.botAdminStatusSource ?? "unknown",
          statusSource: ctx.botAdminStatusSource,
          eventBotIsAdmin: ctx.event.botIsGroupAdmin,
          eventBotAdminSource: ctx.event.botAdminStatusSource,
          groupBotIsAdmin: ctx.groupAccess?.botIsAdmin,
          groupBotCheckedAt: ctx.groupAccess?.botAdminCheckedAt?.toISOString?.(),
          botAdminCheckedAt: ctx.botAdminCheckedAt?.toISOString?.(),
          botAdminCheckFailed: ctx.botAdminCheckFailed,
          botAdminCheckError: ctx.botAdminCheckError,
          resolutionPath: ctx.botAdminResolutionPath?.map((c) => ({ source: c.source, value: c.value }))
        },
        "bot admin state (pre-guard)"
      );
    }

    if (ctx.classification.kind === "ignored_event" || ctx.classification.kind === "system_event") {
      return this.formatActionsForDelivery([{ kind: "noop", reason: ctx.classification.reason ?? ctx.classification.kind }]);
    }

    const policyResult = this.applyPolicies(ctx);
    if (policyResult.stop) return this.formatActionsForDelivery(policyResult.stop);

    const moderationActions = this.enforceModeration(ctx);
    if (moderationActions.length > 0) return this.formatActionsForDelivery(moderationActions);

    const groupPolicy = this.enforceGroupPolicies(ctx);
    ctx.groupPolicy = { commandsOnly: groupPolicy.commandsOnly };
    if (groupPolicy.stop) return this.formatActionsForDelivery(groupPolicy.stop);

    const consentActions = await this.enforceConsent(ctx);
    if (consentActions.length > 0) return this.formatActionsForDelivery(consentActions);

    const greetingActions = await this.runGreetingStage(ctx);
    if (greetingActions.length > 0) return this.formatActionsForDelivery(greetingActions);

    const triggerActions = await this.runBusinessTriggers(ctx);
    if (triggerActions.length > 0) return this.formatActionsForDelivery(triggerActions);

    const commandActions = await this.runCommandRouter(ctx);
    if (ctx.classification.kind === "command") {
      const hasError = commandActions.some((a) => a.kind === "error");
      const summary = commandActions.length === 0 ? "noop" : commandActions.map((a) => a.kind).join(",");
      await this.recordAudit({
        kind: "command",
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId,
        conversationId: ctx.event.conversationId,
        command: ctx.event.normalizedText.split(/\s+/)[0] ?? ctx.event.normalizedText,
        inputText: ctx.event.text,
        resultSummary: summary,
        status: hasError ? "error" : "ok",
        metadata: { classification: ctx.classification.kind }
      });
      await this.bumpMetric("commands_executed_total");
      for (const action of commandActions) {
        if (action.kind === "enqueue_job" && action.jobType === "reminder") {
          await this.bumpMetric("reminders_created_total");
          await this.recordAudit({
            kind: "reminder",
            tenantId: ctx.event.tenantId,
            waUserId: ctx.event.waUserId,
            waGroupId: ctx.event.waGroupId,
            reminderId: String(action.payload?.id ?? action.payload?.reminderId ?? "unknown"),
            status: "scheduled"
          });
        }
      }
    }
    if (commandActions.length > 0) return this.formatActionsForDelivery(commandActions);

    if (ctx.classification.kind === "tool_follow_up") {
      const followUp = await this.handlePendingToolFollowUp(ctx);
      if (followUp.length > 0) return this.formatActionsForDelivery(followUp);
    }

    const naturalActions = await this.runNaturalLanguageTools(ctx);
    if (naturalActions.length > 0) return this.formatActionsForDelivery(naturalActions);

    const aiActions = await this.runAiFallback(ctx);
    if (aiActions.length > 0) return this.formatActionsForDelivery(aiActions);

    if (ctx.policyMuted) {
      const activeMute = ctx.userMuteInfo ?? ctx.muteInfo;
      return this.formatActionsForDelivery([{ kind: "reply_text", text: this.buildMuteText(activeMute, ctx.timezone, Boolean(ctx.userMuteInfo)) }]);
    }

    return this.formatActionsForDelivery([{ kind: "noop", reason: "no_action" }]);
  }
}
