import type { ConsentStatus, RelationshipProfile } from "../../../pipeline/types.js";

export type GovernanceContextScope = "private" | "group";
export type GovernanceDecision = "allow" | "deny";
export type GovernanceAccessStatus = "PENDING" | "APPROVED" | "BLOCKED" | "UNKNOWN";
export type GovernanceLicenseTier = "FREE" | "BASIC" | "PRO" | "ROOT" | "UNKNOWN";

export type GovernanceRequiredRole = "member" | "admin" | "root" | "group_admin" | "privileged";

export interface DecisionInput {
  tenant: {
    id: string;
  };
  user: {
    waUserId: string;
    userId?: string;
    permissionRole?: string | null;
    relationshipProfile?: RelationshipProfile | null;
    isPrivileged?: boolean | null;
    isBotAdmin?: boolean | null;
    senderIsGroupAdmin?: boolean | null;
  };
  group?: {
    id?: string;
    waGroupId: string;
    name?: string | null;
  };
  context: {
    scope: GovernanceContextScope;
    isGroup: boolean;
    routeKey?: string;
  };
  consent?: {
    status?: ConsentStatus | "UNKNOWN" | null;
    termsVersion?: string | null;
    bypass?: boolean;
    required?: boolean;
  };
  request: {
    capability: string;
    commandName?: string;
    requiredRole?: GovernanceRequiredRole;
    requiresBotAdmin?: boolean;
    requiresGroupAdmin?: boolean;
    route?: string;
  };
  message?: {
    waMessageId?: string;
    kind?: string;
    rawMessageType?: string;
    ingressSource?: string;
    addressedToBot?: boolean;
    isBotMentioned?: boolean;
    isReplyToBot?: boolean;
  };
  runtimePolicySignals?: Record<string, unknown>;
}

export interface GovernancePolicySnapshot {
  evaluatedAt: Date;
  tenantId: string;
  waUserId: string;
  waGroupId?: string;
  scope: GovernanceContextScope;
  actor: {
    isBotAdmin: boolean;
    isPrivileged: boolean;
    permissionRole?: string | null;
    relationshipProfile?: RelationshipProfile | null;
  };
  featureFlags: Record<string, string>;
  group: {
    exists: boolean;
    allowed?: boolean;
    chatMode?: "on" | "off";
    botIsAdmin?: boolean | null;
    botAdminCheckedAt?: Date | null;
  };
  consent: {
    exists: boolean;
    status: ConsentStatus | "UNKNOWN";
    termsVersion?: string | null;
  };
  access: {
    user: {
      exists: boolean;
      status: GovernanceAccessStatus;
      tier: GovernanceLicenseTier;
      approvedBy?: string | null;
      approvedAt?: Date | null;
      source: "persisted" | "default";
    };
    group: {
      exists: boolean;
      status: GovernanceAccessStatus;
      tier: GovernanceLicenseTier;
      approvedBy?: string | null;
      approvedAt?: Date | null;
      source: "persisted" | "default";
    };
    effective: {
      source: "user" | "group" | "none";
      status: GovernanceAccessStatus;
      tier: GovernanceLicenseTier;
    };
  };
  runtimePolicySignals: Record<string, unknown>;
}

export type GovernanceReasonCode =
  | "ALLOW_POLICY_PASSED"
  | "ALLOW_PRIVILEGED_OVERRIDE"
  | "DENY_TENANT_POLICY"
  | "DENY_CAPABILITY_DISABLED"
  | "DENY_ACCESS_PENDING"
  | "DENY_ACCESS_BLOCKED"
  | "DENY_LICENSE_CAPABILITY"
  | "DENY_QUOTA_LIMIT"
  | "DENY_GROUP_NOT_ALLOWED"
  | "DENY_GROUP_CHAT_OFF"
  | "DENY_CONSENT_REQUIRED"
  | "DENY_BOT_ADMIN_REQUIRED"
  | "DENY_GROUP_ADMIN_REQUIRED"
  | "DENY_REQUESTER_ROLE"
  | "DIAGNOSTIC_RUNTIME_BOT_ADMIN_CHECK_FAILED";

export interface GovernanceQuotaConsumeInput {
  tenantId: string;
  waUserId: string;
  waGroupId?: string;
  capability: string;
  limit: number;
  periodKey: string;
  bucket: string;
  metadata?: Record<string, unknown>;
}

export interface GovernanceQuotaConsumeResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  bucket: string;
  periodKey: string;
}

export interface GovernancePolicyDiagnostic {
  code: GovernanceReasonCode;
  severity: "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}

export interface DecisionResult {
  decision: GovernanceDecision;
  allow: boolean;
  allowedCapabilities: string[];
  blockedByPolicy: boolean;
  blocked_by_policy: boolean;
  reasonCodes: GovernanceReasonCode[];
  diagnostics: GovernancePolicyDiagnostic[];
  approval: {
    required: boolean;
    state: "not_required" | "required" | "pending" | "approved" | "rejected";
    requestedBy?: string | null;
    approvedBy?: string | null;
    referenceId?: string | null;
  };
  licensing: {
    state: "not_evaluated" | "active" | "expired" | "blocked";
    planId?: string | null;
    quota?: {
      limit?: number | null;
      used?: number | null;
      remaining?: number | null;
      bucket?: string | null;
      periodKey?: string | null;
      reasonCode?: GovernanceReasonCode | null;
    };
  };
  fallback: {
    mode: "none" | "route_default" | "assistive_reply_only" | "deny_all";
    reasonCode?: GovernanceReasonCode | null;
  };
  snapshot: GovernancePolicySnapshot;
}
