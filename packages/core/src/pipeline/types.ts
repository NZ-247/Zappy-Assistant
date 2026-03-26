export type Scope = "GLOBAL" | "TENANT" | "GROUP" | "USER";

export type MatchType = "CONTAINS" | "REGEX" | "STARTS_WITH";

export type RelationshipProfile =
  | "creator_root"
  | "mother_privileged"
  | "delegated_owner"
  | "admin"
  | "member"
  | "external_contact";

export type GroupChatMode = "on" | "off";
export type GroupFunMode = "on" | "off";

export interface GroupModerationSettings {
  antiLink?: boolean;
  autoDeleteLinks?: boolean;
  antiSpam?: boolean;
  tempMuteSeconds?: number;
}

export interface GroupAccessState {
  waGroupId: string;
  groupName?: string | null;
  description?: string | null;
  allowed: boolean;
  chatMode: GroupChatMode;
  isOpen?: boolean;
  welcomeEnabled?: boolean;
  welcomeText?: string | null;
  fixedMessageText?: string | null;
  rulesText?: string | null;
  funMode?: GroupFunMode;
  moderation?: GroupModerationSettings;
  botIsAdmin?: boolean;
  botAdminCheckedAt?: Date | null;
}

export interface CanonicalIdentity {
  canonicalUserKey: string;
  waUserId: string;
  phoneNumber?: string | null;
  lidJid?: string | null;
  pnJid?: string | null;
  aliases: string[];
  displayName?: string | null;
  permissionRole?: string | null;
  relationshipProfile?: RelationshipProfile | null;
}

export type MessageKind = "text" | "media" | "system" | "unknown";

export type MessageClassificationKind =
  | "system_event"
  | "ignored_event"
  | "consent_pending"
  | "command"
  | "trigger_candidate"
  | "ai_candidate"
  | "tool_follow_up";

export interface MessageClassification {
  kind: MessageClassificationKind;
  reason?: string;
  commandName?: string;
  commandKnown?: boolean;
}

export type MetricKey =
  | "messages_received_total"
  | "commands_executed_total"
  | "trigger_matches_total"
  | "ai_requests_total"
  | "ai_failures_total"
  | "reminders_created_total"
  | "reminders_sent_total"
  | "moderation_actions_total"
  | "onboarding_pending_total"
  | "onboarding_accepted_total";

export type AuditEvent =
  | {
      kind: "command";
      tenantId: string;
      conversationId?: string;
      waUserId: string;
      waGroupId?: string;
      command: string;
      inputText?: string;
      resultSummary?: string;
      status: string;
      metadata?: Record<string, unknown>;
    }
  | {
      kind: "trigger";
      tenantId: string;
      conversationId?: string;
      waUserId: string;
      waGroupId?: string;
      triggerId?: string;
      triggerName?: string;
      actor?: string;
    }
  | {
      kind: "consent";
      tenantId: string;
      waUserId: string;
      waGroupId?: string;
      status: "PENDING" | "ACCEPTED" | "DECLINED";
      version: string;
      actor?: string;
    }
  | {
      kind: "reminder";
      tenantId: string;
      waUserId: string;
      waGroupId?: string;
      reminderId: string;
      status: "scheduled" | "sent" | "failed";
      message?: string;
      actor?: string;
    }
  | {
      kind: "moderation";
      tenantId: string;
      waUserId: string;
      waGroupId?: string;
      action: string;
      targetWaUserId?: string;
      success?: boolean;
      result?: string;
      actor?: string;
    }
  | {
      kind: "settings";
      tenantId: string;
      waUserId: string;
      waGroupId?: string;
      scope: Scope;
      key: string;
      value?: string;
      action: string;
      actor?: string;
    }
  | {
      kind: "role_change";
      tenantId: string;
      waUserId: string;
      waGroupId?: string;
      targetWaUserId: string;
      role: string;
      action: string;
      scope?: Scope;
      actor?: string;
    };

export interface InboundMessageEvent {
  tenantId: string;
  conversationId?: string;
  executionId?: string;
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
  mentionedWaUserIds?: string[];
  isBotMentioned?: boolean;
  quotedWaMessageId?: string;
  quotedWaUserId?: string;
  quotedMessageType?: string;
  quotedText?: string;
  quotedHasMedia?: boolean;
  isReplyToBot?: boolean;
  senderIsGroupAdmin?: boolean;
  messageKey?: { id: string; remoteJid?: string; fromMe?: boolean; participant?: string };
  botIsGroupAdmin?: boolean;
  botAdminStatusSource?: "live" | "cache" | "fallback" | "operation";
  botAdminCheckedAt?: Date;
  botAdminCheckFailed?: boolean;
  botAdminCheckError?: string;
  groupName?: string;
  ingressSource?: "text" | "audio_stt";
  sttTranscript?: string;
  sttCommandText?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type ToolAction =
  | "create_task"
  | "update_task"
  | "complete_task"
  | "delete_task"
  | "list_tasks"
  | "create_reminder"
  | "update_reminder"
  | "delete_reminder"
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
  userDisplayName?: string;
  chatScope: "direct" | "group";
  userRole: "ROOT" | "DONO" | "GROUP_ADMIN" | "ADMIN" | "MEMBER";
  relationshipProfile?: RelationshipProfile;
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
  | "WAITING_CONSENT"
  | "WAITING_CONFIRMATION"
  | "WAITING_TASK_DETAILS"
  | "WAITING_REMINDER_DETAILS"
  | "WAITING_TOOL_DETAILS"
  | "WAITING_TOOL_CONFIRMATION"
  | "HANDOFF_ACTIVE";

export interface ConversationStateRecord {
  state: ConversationState;
  context?: Record<string, unknown>;
  updatedAt: Date;
  expiresAt?: Date | null;
}

export type ConsentStatus = "PENDING" | "ACCEPTED" | "DECLINED";

export interface UserConsentRecord {
  id: string;
  tenantId: string;
  userId: string;
  status: ConsentStatus;
  termsVersion: string;
  acceptedAt?: Date | null;
  declinedAt?: Date | null;
  source?: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  publicId: string;
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
  publicId: string;
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
