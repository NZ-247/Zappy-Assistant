import type {
  CanonicalIdentity,
  ConversationMessage,
  ConversationStateRecord,
  GroupAccessState,
  GroupChatMode,
  GroupFunMode,
  GroupModerationSettings,
  InboundMessageEvent,
  MessageClassification,
  MessageKind,
  RelationshipProfile,
  Scope,
  UserConsentRecord
} from "./types.js";

export type NormalizedEvent = InboundMessageEvent & {
  normalizedText: string;
  messageKind: MessageKind;
  isStatusBroadcast: boolean;
  isFromBot: boolean;
  hasMedia: boolean;
};

export type PipelineContext = {
  event: NormalizedEvent;
  scope: { scope: Scope; scopeId: string };
  relationshipProfile: RelationshipProfile;
  relationshipReason?: string;
  flags: Record<string, string>;
  assistantMode: "off" | "professional" | "fun" | "mixed";
  funMode: "off" | "on";
  downloadsMode: "off" | "allowlist" | "on";
  timezone: string;
  now: Date;
  defaultReminderTime: string;
  memoryLimit: number;
  classification: MessageClassification;
  muteInfo?: { until: Date } | null;
  userMuteInfo?: { until: Date } | null;
  conversationState: ConversationStateRecord;
  consent?: UserConsentRecord | null;
  consentRequired: boolean;
  bypassConsent: boolean;
  consentVersion: string;
  identity?: {
    displayName?: string | null;
    role: string;
    permissionRole?: string | null;
    permissions: string[];
    groupName?: string;
    canonicalIdentity?: CanonicalIdentity;
    relationshipProfile?: RelationshipProfile | null;
    relationshipReason?: string | null;
  };
  groupAccess?: GroupAccessState;
  groupAllowed: boolean;
  groupChatMode: GroupChatMode;
  groupIsOpen?: boolean;
  groupWelcomeEnabled?: boolean;
  groupWelcomeText?: string | null;
  groupFixedMessageText?: string | null;
  groupRulesText?: string | null;
  groupModeration?: GroupModerationSettings;
  botIsGroupAdmin: boolean;
  botAdminStatusSource?: "live" | "cache" | "fallback" | "operation";
  botAdminSourceUsed?: string;
  botAdminResolutionPath?: Array<{ source: string; value?: boolean; checkedAt?: Date }>;
  botAdminCheckedAt?: Date;
  botAdminCheckFailed?: boolean;
  botAdminCheckError?: string;
  isBotMentioned: boolean;
  isReplyToBot: boolean;
  mentionedWaUserIds: string[];
  requesterIsAdmin: boolean;
  requesterIsGroupAdmin?: boolean;
  groupPolicy?: { commandsOnly?: boolean };
  recentMessages: ConversationMessage[];
  policyMuted: boolean;
};
