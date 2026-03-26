import {
  DEFAULT_REMINDER_TIME,
  formatDateTimeInZone,
  normalizeTimezone
} from "./time.js";
import {
  formatCommand,
  normalizeCommandPrefix
} from "./commands/parser/prefix.js";
import { createCommandRegistry } from "./commands/registry/index.js";
import type { CommandRegistry } from "./commands/registry/command-types.js";
import { AssistantAiModule } from "./modules/assistant-ai/index.js";
import { checkConsentGate } from "./modules/consent/application/use-cases/check-consent-gate.js";
import { enforceConsent } from "./modules/consent/application/use-cases/enforce-consent.js";
import { hasRootPrivileges, resolveRelationshipProfile } from "./modules/identity/domain/relationship-profile.js";
import { resolveSafeDisplayName } from "./modules/identity/domain/safe-display-name.js";
import { maybeBuildAutoAudioAction } from "./modules/tools/audio/application/use-cases/maybe-build-auto-audio-action.js";
import { runCommandRouter as runCommandRouterStage } from "./orchestrator/command-router.js";
import {
  classifyMessage as classifyMessageStage,
  isGreetingMessage as isGreetingMessagePolicy,
  isGreetingPattern as isGreetingPatternPolicy,
  shouldSkipGenericGreeting as shouldSkipGenericGreetingPolicy
} from "./orchestrator/message-classification.js";
import {
  applyPolicies as applyPoliciesStage,
  commandRequiresGroupAdmin,
  enforceGroupPolicies as enforceGroupPoliciesStage,
  enforceModeration as enforceModerationStage
} from "./orchestrator/policy-stages.js";
import {
  runBusinessTriggers as runBusinessTriggersStage,
  runGreetingStage as runGreetingPolicyStage
} from "./orchestrator/policy-triggers.js";
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
  ReplyAudioAction,
  ReplyImageAction,
  ReplyListAction,
  EnqueueJobAction,
  NoopAction,
  ErrorAction,
  HandoffAction,
  AiToolSuggestionAction,
  AudioTranscriptionSource,
  AudioTranscriptionMode,
  AudioTranscriptionAction,
  StickerTransformOperation,
  StickerTransformSource,
  StickerTransformAction,
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
  TextToSpeechPort,
  TextTranslationPort,
  WebSearchPort,
  SearchAiPort,
  ImageSearchPort,
  MediaDownloadPort,
  MediaDownloadProvider,
  WebSearchResultItem,
  SearchAiSourceItem,
  ImageLicenseInfo,
  ImageSearchResultItem,
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
  ReplyAudioAction,
  ReplyImageAction,
  ReplyListAction,
  EnqueueJobAction,
  NoopAction,
  ErrorAction,
  HandoffAction,
  AiToolSuggestionAction,
  AudioTranscriptionSource,
  AudioTranscriptionMode,
  AudioTranscriptionAction,
  StickerTransformOperation,
  StickerTransformSource,
  StickerTransformAction,
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
  TextToSpeechPort,
  TextTranslationPort,
  WebSearchPort,
  SearchAiPort,
  ImageSearchPort,
  MediaDownloadPort,
  MediaDownloadProvider,
  WebSearchResultItem,
  SearchAiSourceItem,
  ImageLicenseInfo,
  ImageSearchResultItem,
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
export { resolveRelationshipProfile } from "./modules/identity/domain/relationship-profile.js";
export type { AudioModuleConfigPort, SpeechToTextPort } from "./modules/tools/audio/ports.js";

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
  private readonly assistantAi: AssistantAiModule;

  constructor(ports: CorePorts) {
    this.ports = ports;
    this.commandPrefix = normalizeCommandPrefix(ports.commandPrefix);
    this.commandRegistry = createCommandRegistry(this.commandPrefix);
    this.llmUnavailableText = `No momento estou sem acesso ao assistente inteligente. Você ainda pode usar ${formatCommand(this.commandPrefix, "help")}, ${formatCommand(this.commandPrefix, "task")} e ${formatCommand(this.commandPrefix, "reminder")}.`;
    this.consentTermsVersion = ports.consentTermsVersion ?? "2026-03";
    this.consentLink = ports.consentLink ?? "https://services.net.br/politicas";
    this.consentSource = ports.consentSource ?? "wa-gateway";
    this.assistantAi = new AssistantAiModule({
      ports: this.ports,
      commandPrefix: this.commandPrefix,
      pendingStateTtlMs: this.pendingStateTtlMs,
      llmUnavailableText: this.llmUnavailableText,
      hasRootPrivilege: (ctx) => this.hasRootPrivilege(ctx),
      bumpMetric: (key, by) => this.bumpMetric(key, by),
      stylizeReply: (ctx, text, options) => this.stylizeReply(ctx, text, options)
    });
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
      quotedMessageType: event.quotedMessageType,
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
    const audioCapabilityEnabled =
      String(flags.audio_capability_enabled ?? (this.ports.audioCapabilityEnabled ? "on" : "off")).toLowerCase() === "on";
    const audioAutoTranscribeEnabled =
      String(flags.audio_auto_transcribe_enabled ?? (this.ports.audioAutoTranscribeEnabled ? "on" : "off")).toLowerCase() === "on";
    const audioCommandDispatchEnabled =
      String(flags.audio_command_dispatch_enabled ?? (this.ports.audioCommandDispatchEnabled ? "on" : "off")).toLowerCase() === "on";

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
    const addressingName = resolveSafeDisplayName({
      trustedProfileName: identity?.displayName ?? null,
      friendlyName: identity?.canonicalIdentity?.displayName ?? null,
      fallback: "você"
    });

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
      addressingName,
      audioCapabilityEnabled,
      audioAutoTranscribeEnabled,
      audioCommandDispatchEnabled,
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

    const consentGate = checkConsentGate({
      consent,
      consentVersion: this.consentTermsVersion,
      permissionRole: identity?.permissionRole,
      role: identity?.role,
      relationshipProfile: relationship.profile,
      conversationState
    });

    ctx.bypassConsent = consentGate.bypassConsent;
    ctx.consentRequired = consentGate.consentRequired;

    if (consentGate.shouldClearConversationState) {
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

  private async classifyMessage(ctx: PipelineContext): Promise<MessageClassification> {
    return classifyMessageStage(ctx, {
      commandRegistry: this.commandRegistry,
      isDuplicate: async (event) => this.isDuplicate(event),
      hasRootPrivilege: (input) => this.hasRootPrivilege(input)
    });
  }

  private enforceGroupPolicies(ctx: PipelineContext): { stop?: ResponseAction[]; commandsOnly?: boolean } {
    return enforceGroupPoliciesStage(ctx, {
      commandPrefix: this.commandPrefix,
      logger: this.ports.logger,
      isRequesterAdmin: (input) => this.isRequesterAdmin(input),
      stylizeReply: (input, text, options) => this.stylizeReply(input, text, options)
    });
  }

  private applyPolicies(ctx: PipelineContext): { stop?: ResponseAction[] } {
    return applyPoliciesStage(ctx);
  }

  private enforceModeration(ctx: PipelineContext): ResponseAction[] {
    return enforceModerationStage(ctx, {
      isRequesterAdmin: (input) => this.isRequesterAdmin(input),
      stylizeReply: (input, text, options) => this.stylizeReply(input, text, options)
    });
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

  private buildMuteText(muteInfo: { until: Date } | null | undefined, timezone: string, scoped?: boolean): string {
    const until = muteInfo?.until ? formatDateTimeInZone(muteInfo.until, timezone) : "(desconhecido)";
    if (scoped) return `🤫 Você está silenciado neste grupo até ${until}.`;
    return `🤫 Estou em silêncio até ${until}. Envie ${formatCommand(this.commandPrefix, "mute off")} para reativar.`;
  }

  private async clearConversationState(ctx: PipelineContext): Promise<void> {
    if (!this.ports.conversationState) return;
    await this.ports.conversationState.clearState({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId
    });
  }

  private async runGreetingStage(ctx: PipelineContext): Promise<ResponseAction[]> {
    return runGreetingPolicyStage(ctx, {
      greetingCooldownSeconds: this.greetingCooldownSeconds,
      botName: this.ports.botName,
      stylizeReply: (input, text, options) => this.stylizeReply(input, text, options),
      shouldSkipGenericGreeting: (input) =>
        shouldSkipGenericGreetingPolicy(input, {
          hasRootPrivilege: (pipelineInput) => this.hasRootPrivilege(pipelineInput)
        }),
      isGreetingMessage: (text) => isGreetingMessagePolicy(text),
      isGreetingPattern: (pattern) => isGreetingPatternPolicy(pattern),
      recordAudit: async (event) => this.recordAudit(event),
      bumpMetric: async (key, by) => this.bumpMetric(key, by),
      loadTriggers: async (input) => this.ports.triggersRepository.findActiveByScope(input),
      canFireCooldown: async (key, ttlSeconds) => this.ports.cooldown.canFire(key, ttlSeconds)
    });
  }

  private async runBusinessTriggers(ctx: PipelineContext): Promise<ResponseAction[]> {
    return runBusinessTriggersStage(ctx, {
      greetingCooldownSeconds: this.greetingCooldownSeconds,
      botName: this.ports.botName,
      stylizeReply: (input, text, options) => this.stylizeReply(input, text, options),
      shouldSkipGenericGreeting: (input) =>
        shouldSkipGenericGreetingPolicy(input, {
          hasRootPrivilege: (pipelineInput) => this.hasRootPrivilege(pipelineInput)
        }),
      isGreetingMessage: (text) => isGreetingMessagePolicy(text),
      isGreetingPattern: (pattern) => isGreetingPatternPolicy(pattern),
      recordAudit: async (event) => this.recordAudit(event),
      bumpMetric: async (key, by) => this.bumpMetric(key, by),
      loadTriggers: async (input) => this.ports.triggersRepository.findActiveByScope(input),
      canFireCooldown: async (key, ttlSeconds) => this.ports.cooldown.canFire(key, ttlSeconds)
    });
  }

  private async runCommandRouter(ctx: PipelineContext): Promise<ResponseAction[]> {
    return runCommandRouterStage(ctx, {
      ports: this.ports,
      commandPrefix: this.commandPrefix,
      commandRegistry: this.commandRegistry,
      botAdminStaleMs: this.botAdminStaleMs,
      botAdminOperationStaleMs: this.botAdminOperationStaleMs,
      hasRootPrivilege: (input) => this.hasRootPrivilege(input),
      isRequesterAdmin: (input) => this.isRequesterAdmin(input),
      commandRequiresGroupAdmin: (name) => commandRequiresGroupAdmin(name),
      stylizeReply: (input, text, options) => this.stylizeReply(input, text, options)
    });
  }

  private async runPolicyAndConsentStages(ctx: PipelineContext): Promise<ResponseAction[] | null> {
    const policyResult = this.applyPolicies(ctx);
    if (policyResult.stop) return policyResult.stop;

    const moderationActions = this.enforceModeration(ctx);
    if (moderationActions.length > 0) return moderationActions;

    const groupPolicy = this.enforceGroupPolicies(ctx);
    ctx.groupPolicy = { commandsOnly: groupPolicy.commandsOnly };
    if (groupPolicy.stop) return groupPolicy.stop;

    const consentResult = await enforceConsent(ctx, {
      consentPort: this.ports.consent,
      conversationState: this.ports.conversationState,
      audit: this.ports.audit,
      metrics: this.ports.metrics,
      logger: this.ports.logger,
      consentLink: this.consentLink,
      consentVersion: this.consentTermsVersion,
      consentSource: this.consentSource,
      commandPrefix: this.commandPrefix,
      pendingStateTtlMs: this.pendingStateTtlMs,
      now: ctx.now,
      stylizeReply: (text, options) => this.stylizeReply(ctx, text, options)
    });
    if (consentResult.consent) ctx.consent = consentResult.consent;
    if (consentResult.consentRequired !== undefined) ctx.consentRequired = consentResult.consentRequired;
    if (consentResult.conversationState) ctx.conversationState = consentResult.conversationState;
    if (consentResult.actions.length > 0) return consentResult.actions;

    return null;
  }

  private async runAiFallbackStages(ctx: PipelineContext): Promise<ResponseAction[]> {
    if (ctx.classification.kind === "tool_follow_up") {
      const followUp = await this.assistantAi.handlePendingToolFollowUp(ctx);
      if (followUp.length > 0) return followUp;
    }

    const naturalActions = await this.assistantAi.handleAddressedMessage(ctx);
    if (naturalActions.length > 0) return naturalActions;

    const fallbackActions = await this.assistantAi.runFallback(ctx);
    if (fallbackActions.length > 0) return fallbackActions;

    return [];
  }

  private runAudioIngressStage(ctx: PipelineContext): ResponseAction[] {
    return maybeBuildAutoAudioAction({
      ctx,
      config: {
        capabilityEnabled: ctx.audioCapabilityEnabled,
        autoTranscribeInboundAudio: ctx.audioAutoTranscribeEnabled,
        allowDynamicCommandDispatch: ctx.audioCommandDispatchEnabled,
        commandPrefix: this.commandPrefix
      }
    });
  }

  private async resolveContextAndClassification(normalized: NormalizedEvent): Promise<PipelineContext> {
    const ctx = await this.buildContext(normalized);
    ctx.classification = await this.classifyMessage(ctx);
    return ctx;
  }

  async handleInboundMessage(event: InboundMessageEvent): Promise<ResponseAction[]> {
    const normalized = this.normalizeEvent(event);
    await this.bumpMetric("messages_received_total");
    const rate = await this.enforceRateLimits(normalized);
    if (!rate.allowed) return this.formatActionsForDelivery(rate.action ? [rate.action] : [{ kind: "noop", reason: "rate_limit" }]);

    const ctx = await this.resolveContextAndClassification(normalized);

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

    const policyActions = await this.runPolicyAndConsentStages(ctx);
    if (policyActions) return this.formatActionsForDelivery(policyActions);

    const greetingActions = await this.runGreetingStage(ctx);
    if (greetingActions.length > 0) return this.formatActionsForDelivery(greetingActions);

    const triggerActions = await this.runBusinessTriggers(ctx);
    if (triggerActions.length > 0) return this.formatActionsForDelivery(triggerActions);

    const commandExecutionId =
      ctx.classification.kind === "command"
        ? `cmd_${(ctx.event.executionId ?? ctx.event.waMessageId).replace(/[^a-zA-Z0-9_-]/g, "").slice(-24)}_${ctx.now.getTime().toString(36)}`
        : undefined;
    if (ctx.classification.kind === "command") {
      this.ports.logger?.info?.(
        {
          category: "COMMAND_TRACE",
          phase: "start",
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId,
          waMessageId: ctx.event.waMessageId,
          executionId: ctx.event.executionId,
          commandExecutionId,
          commandName: ctx.classification.commandName
        },
        "command execution started"
      );
    }

    const commandActions = await this.runCommandRouter(ctx);
    if (ctx.classification.kind === "command") {
      const hasError = commandActions.some((a) => a.kind === "error");
      const summary = commandActions.length === 0 ? "noop" : commandActions.map((a) => a.kind).join(",");
      this.ports.logger?.info?.(
        {
          category: "COMMAND_TRACE",
          phase: "finish",
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId,
          waUserId: ctx.event.waUserId,
          waMessageId: ctx.event.waMessageId,
          executionId: ctx.event.executionId,
          commandExecutionId,
          commandName: ctx.classification.commandName,
          resultSummary: summary,
          status: hasError ? "error" : "ok"
        },
        "command execution finished"
      );
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
        metadata: {
          classification: ctx.classification.kind,
          commandName: ctx.classification.commandName,
          executionId: ctx.event.executionId,
          commandExecutionId,
          inboundWaMessageId: ctx.event.waMessageId
        }
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
    if (ctx.classification.kind === "command") {
      const unknownMessage = this.stylizeReply(ctx, `Comando desconhecido. Use ${formatCommand(this.commandPrefix, "help")}.`);
      return this.formatActionsForDelivery([{ kind: "reply_text", text: unknownMessage }]);
    }

    const audioIngressActions = this.runAudioIngressStage(ctx);
    if (audioIngressActions.length > 0) return this.formatActionsForDelivery(audioIngressActions);

    const aiActions = await this.runAiFallbackStages(ctx);
    if (aiActions.length > 0) return this.formatActionsForDelivery(aiActions);

    if (ctx.policyMuted) {
      const activeMute = ctx.userMuteInfo ?? ctx.muteInfo;
      return this.formatActionsForDelivery([{ kind: "reply_text", text: this.buildMuteText(activeMute, ctx.timezone, Boolean(ctx.userMuteInfo)) }]);
    }

    return this.formatActionsForDelivery([{ kind: "noop", reason: "no_action" }]);
  }
}
