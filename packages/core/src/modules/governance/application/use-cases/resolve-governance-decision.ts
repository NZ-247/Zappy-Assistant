import type {
  DecisionInput,
  DecisionResult,
  GovernanceLicenseTier,
  GovernancePolicyDiagnostic,
  GovernanceReasonCode,
  GovernanceRequiredRole
} from "../../domain/governance-decision.js";
import type { GovernancePort } from "../../ports/governance.port.js";

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled", "allow", "allowed"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled", "deny", "denied"]);

const DEFAULT_ALLOWED_CAPABILITIES = [
  "conversation.direct",
  "conversation.group",
  "ai.addressed",
  "tool.intent",
  "tasks",
  "notes",
  "reminders",
  "moderation",
  "group.settings",
  "audio.transcribe",
  "tts",
  "translation",
  "search.web",
  "search.ai",
  "search.image",
  "media.download"
];

const DEFAULT_FREE_DIRECT_CHAT_LIMIT = 30;
const FREE_DIRECT_CHAT_QUOTA_BUCKET = "conversation.direct.free.daily";

const TIER_CAPABILITY_ALIASES = new Map<string, string>([
  ["conversation", "conversation.direct"],
  ["conversation.direct", "conversation.direct"],
  ["conversation.group", "conversation.group"],
  ["search.basic", "search.basic"],
  ["search.web", "search.basic"],
  ["web-search", "search.basic"],
  ["search", "search.basic"],
  ["image.basic", "image.basic"],
  ["search.image", "image.basic"],
  ["image-search", "image.basic"],
  ["tts.basic", "tts.basic"],
  ["tts", "tts.basic"],
  ["transcribe.basic", "transcribe.basic"],
  ["audio.transcribe", "transcribe.basic"],
  ["search_ai.premium", "search_ai.premium"],
  ["search.ai", "search_ai.premium"],
  ["search-ai", "search_ai.premium"],
  ["download.premium", "download.premium"],
  ["media.download", "download.premium"],
  ["downloads", "download.premium"]
]);

const FREE_TIER_CAPABILITIES = new Set(["conversation.direct", "conversation.group", "search.basic", "image.basic", "tts.basic", "transcribe.basic"]);
const BASIC_TIER_CAPABILITIES = new Set([...FREE_TIER_CAPABILITIES]);
const PRO_TIER_CAPABILITIES = new Set([...BASIC_TIER_CAPABILITIES, "search_ai.premium", "download.premium"]);
const TIER_GATED_CAPABILITIES = new Set([...PRO_TIER_CAPABILITIES]);

const normalizeRole = (value?: string | null): string => (value ?? "").trim().toLowerCase();

const parseBooleanFlag = (value?: string): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
};

const parsePositiveInt = (value?: string): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const normalizeCapabilitySlug = (capability: string): string => capability.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const normalizeTierCapability = (capability: string): string => {
  const normalized = capability.trim().toLowerCase();
  return TIER_CAPABILITY_ALIASES.get(normalized) ?? normalized;
};

const tierAllowsCapability = (tier: GovernanceLicenseTier, capability: string): boolean => {
  if (!TIER_GATED_CAPABILITIES.has(capability)) return true;
  if (tier === "ROOT") return true;
  if (tier === "PRO") return PRO_TIER_CAPABILITIES.has(capability);
  if (tier === "BASIC") return BASIC_TIER_CAPABILITIES.has(capability);
  if (tier === "FREE") return FREE_TIER_CAPABILITIES.has(capability);
  return true;
};

const buildFeatureFlagIndex = (flags: Record<string, string>): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(flags)) {
    out.set(key.toLowerCase(), value);
  }
  return out;
};

const resolveCapabilityFlag = (flagIndex: Map<string, string>, capability: string): boolean | undefined => {
  const rawCapability = capability.trim().toLowerCase();
  if (!rawCapability) return undefined;
  const slug = normalizeCapabilitySlug(rawCapability);
  const candidates = [
    `capability.${rawCapability}.enabled`,
    `capability.${slug}.enabled`,
    `feature.${slug}.enabled`,
    `governance.capability.${slug}.enabled`
  ];

  for (const key of candidates) {
    const parsed = parseBooleanFlag(flagIndex.get(key));
    if (parsed !== undefined) return parsed;
  }

  return undefined;
};

const resolveDenyAllFlag = (flagIndex: Map<string, string>): boolean => {
  const keys = ["governance.deny_all", "governance.policy.deny_all", "policy.deny_all", "tenant.deny_all"];
  for (const key of keys) {
    if (parseBooleanFlag(flagIndex.get(key)) === true) return true;
  }
  return false;
};

const resolveFreeDirectChatLimit = (input: { flagIndex: Map<string, string>; runtimePolicySignals: Record<string, unknown> }): number => {
  const fromRuntime = Number.parseInt(String(input.runtimePolicySignals.freeDirectChatLimit ?? ""), 10);
  if (Number.isFinite(fromRuntime) && fromRuntime > 0) return fromRuntime;

  const keys = ["quota.free_direct_chat.limit", "governance.quota.free_direct_chat.limit", "quota.free_chat.limit", "governance.quota.free_chat.limit"];
  for (const key of keys) {
    const parsed = parsePositiveInt(input.flagIndex.get(key));
    if (parsed !== undefined) return parsed;
  }

  return DEFAULT_FREE_DIRECT_CHAT_LIMIT;
};

const buildDailyPeriodKey = (date: Date): string => date.toISOString().slice(0, 10);

const resolveAllowedCapabilities = (featureFlags: Record<string, string>): string[] => {
  const flagIndex = buildFeatureFlagIndex(featureFlags);
  const allowed = new Set<string>(DEFAULT_ALLOWED_CAPABILITIES);

  for (const [key, rawValue] of flagIndex.entries()) {
    if (!key.startsWith("capability.") || !key.endsWith(".enabled")) continue;
    const capabilityKey = key.slice("capability.".length, -".enabled".length).trim();
    if (!capabilityKey) continue;
    const capability = capabilityKey.replace(/_/g, ".");
    const parsed = parseBooleanFlag(rawValue);
    if (parsed === false) allowed.delete(capability);
    if (parsed === true) allowed.add(capability);
  }

  return [...allowed].sort((a, b) => a.localeCompare(b));
};

const isRootRole = (role?: string | null): boolean => {
  const normalized = normalizeRole(role);
  return normalized === "root" || normalized === "dono" || normalized === "owner";
};

const isAdminRole = (role?: string | null): boolean => {
  const normalized = normalizeRole(role);
  return normalized === "admin" || isRootRole(normalized);
};

const hasRequiredRole = (requiredRole: GovernanceRequiredRole, input: DecisionInput, derived: { isPrivileged: boolean; isBotAdmin: boolean }): boolean => {
  const permissionRole = input.user.permissionRole;
  const senderIsGroupAdmin = input.user.senderIsGroupAdmin === true;

  switch (requiredRole) {
    case "member":
      return true;
    case "admin":
      return derived.isPrivileged || derived.isBotAdmin || isAdminRole(permissionRole);
    case "root":
      return derived.isPrivileged || isRootRole(permissionRole);
    case "group_admin":
      return senderIsGroupAdmin || derived.isPrivileged || derived.isBotAdmin;
    case "privileged":
      return derived.isPrivileged;
    default:
      return true;
  }
};

type EvaluationAccumulator = {
  diagnostics: GovernancePolicyDiagnostic[];
  reasonCodes: Set<GovernanceReasonCode>;
  denyCodes: Set<GovernanceReasonCode>;
};

const addDiagnostic = (
  acc: EvaluationAccumulator,
  diagnostic: GovernancePolicyDiagnostic,
  input: { isDeny?: boolean } = {}
): void => {
  acc.diagnostics.push(diagnostic);
  acc.reasonCodes.add(diagnostic.code);
  if (input.isDeny) acc.denyCodes.add(diagnostic.code);
};

export const resolveGovernanceDecision = async (governancePort: GovernancePort, input: DecisionInput): Promise<DecisionResult> => {
  const snapshot = await governancePort.getSnapshot(input);
  const flagIndex = buildFeatureFlagIndex(snapshot.featureFlags);
  const allowedCapabilities = resolveAllowedCapabilities(snapshot.featureFlags);
  const capability = input.request.capability.trim().toLowerCase();
  const tierCapability = normalizeTierCapability(capability);
  const effectiveAccess = snapshot.access.effective;

  const derived = {
    isPrivileged: Boolean(input.user.isPrivileged ?? snapshot.actor.isPrivileged),
    isBotAdmin: Boolean(input.user.isBotAdmin ?? snapshot.actor.isBotAdmin),
    botIsGroupAdmin:
      typeof snapshot.runtimePolicySignals.botIsGroupAdmin === "boolean"
        ? (snapshot.runtimePolicySignals.botIsGroupAdmin as boolean)
        : snapshot.group.botIsAdmin === true
  };

  const acc: EvaluationAccumulator = {
    diagnostics: [],
    reasonCodes: new Set<GovernanceReasonCode>(),
    denyCodes: new Set<GovernanceReasonCode>()
  };

  if (snapshot.runtimePolicySignals.botAdminCheckFailed === true) {
    addDiagnostic(acc, {
      code: "DIAGNOSTIC_RUNTIME_BOT_ADMIN_CHECK_FAILED",
      severity: "warn",
      message: "Bot admin runtime check recently failed; decision may differ from real-time metadata.",
      context: {
        source: snapshot.runtimePolicySignals.botAdminStatusSource,
        error: snapshot.runtimePolicySignals.botAdminCheckError
      }
    });
  }

  if (effectiveAccess.status === "BLOCKED") {
    addDiagnostic(
      acc,
      {
        code: "DENY_ACCESS_BLOCKED",
        severity: "error",
        message: "Access is blocked for this subject.",
        context: {
          source: effectiveAccess.source
        }
      },
      { isDeny: true }
    );
  } else if (effectiveAccess.status === "PENDING") {
    addDiagnostic(
      acc,
      {
        code: "DENY_ACCESS_PENDING",
        severity: "warn",
        message: "Access is pending approval for this subject.",
        context: {
          source: effectiveAccess.source
        }
      },
      { isDeny: true }
    );
  }

  if (!tierAllowsCapability(effectiveAccess.tier, tierCapability)) {
    addDiagnostic(
      acc,
      {
        code: "DENY_LICENSE_CAPABILITY",
        severity: "error",
        message: "Capability is not available for the current license tier.",
        context: {
          capability,
          normalizedCapability: tierCapability,
          tier: effectiveAccess.tier
        }
      },
      { isDeny: true }
    );
  }

  if (resolveDenyAllFlag(flagIndex)) {
    addDiagnostic(
      acc,
      {
        code: "DENY_TENANT_POLICY",
        severity: "error",
        message: "Tenant deny-all governance policy is enabled."
      },
      { isDeny: true }
    );
  }

  const capabilityFlag = resolveCapabilityFlag(flagIndex, capability);
  if (capabilityFlag === false) {
    addDiagnostic(
      acc,
      {
        code: "DENY_CAPABILITY_DISABLED",
        severity: "error",
        message: "Requested capability is disabled by policy.",
        context: { capability }
      },
      { isDeny: true }
    );
  }

  if (input.context.scope === "group") {
    if (snapshot.group.exists && snapshot.group.allowed === false) {
      addDiagnostic(
        acc,
        {
          code: "DENY_GROUP_NOT_ALLOWED",
          severity: "error",
          message: "Group is not in the allowed list.",
          context: { waGroupId: snapshot.waGroupId }
        },
        { isDeny: true }
      );
    }

    if (snapshot.group.exists && snapshot.group.chatMode === "off") {
      addDiagnostic(
        acc,
        {
          code: "DENY_GROUP_CHAT_OFF",
          severity: "error",
          message: "Group chat mode is OFF in policy settings.",
          context: { waGroupId: snapshot.waGroupId }
        },
        { isDeny: true }
      );
    }

    if (input.request.requiresBotAdmin && derived.botIsGroupAdmin !== true) {
      addDiagnostic(
        acc,
        {
          code: "DENY_BOT_ADMIN_REQUIRED",
          severity: "error",
          message: "Requested operation requires bot admin privileges in this group.",
          context: { waGroupId: snapshot.waGroupId }
        },
        { isDeny: true }
      );
    }

    if (input.request.requiresGroupAdmin && input.user.senderIsGroupAdmin !== true) {
      addDiagnostic(
        acc,
        {
          code: "DENY_GROUP_ADMIN_REQUIRED",
          severity: "error",
          message: "Requester must be group admin for this operation.",
          context: { waUserId: input.user.waUserId, waGroupId: snapshot.waGroupId }
        },
        { isDeny: true }
      );
    }
  }

  const shouldEvaluateConsent = !capability.startsWith("consent.");
  const consentBypass = Boolean(input.consent?.bypass) || derived.isPrivileged;
  const consentStatus = input.consent?.status ?? snapshot.consent.status;
  const consentRequired = input.consent?.required === true;

  if (shouldEvaluateConsent && !consentBypass && (consentRequired || consentStatus !== "ACCEPTED")) {
    addDiagnostic(
      acc,
      {
        code: "DENY_CONSENT_REQUIRED",
        severity: "error",
        message: "Consent is required before this capability can be used.",
        context: { status: consentStatus, required: consentRequired }
      },
      { isDeny: true }
    );
  }

  if (input.request.requiredRole && !hasRequiredRole(input.request.requiredRole, input, derived)) {
    addDiagnostic(
      acc,
      {
        code: "DENY_REQUESTER_ROLE",
        severity: "error",
        message: "Requester role does not satisfy command requirement.",
        context: {
          requiredRole: input.request.requiredRole,
          permissionRole: input.user.permissionRole,
          senderIsGroupAdmin: input.user.senderIsGroupAdmin
        }
      },
      { isDeny: true }
    );
  }

  const quotaSnapshot: NonNullable<DecisionResult["licensing"]["quota"]> = {
    limit: null,
    used: null,
    remaining: null,
    bucket: null,
    periodKey: null,
    reasonCode: null
  };
  const skipQuotaConsumption = snapshot.runtimePolicySignals.skipQuotaConsumption === true;

  if (!skipQuotaConsumption && acc.denyCodes.size === 0 && tierCapability === "conversation.direct" && input.context.scope === "private" && effectiveAccess.tier === "FREE") {
    const limit = resolveFreeDirectChatLimit({
      flagIndex,
      runtimePolicySignals: snapshot.runtimePolicySignals
    });
    const periodKey = buildDailyPeriodKey(snapshot.evaluatedAt);
    quotaSnapshot.limit = limit;
    quotaSnapshot.bucket = FREE_DIRECT_CHAT_QUOTA_BUCKET;
    quotaSnapshot.periodKey = periodKey;

    if (governancePort.consumeQuota) {
      const quotaResult = await governancePort.consumeQuota({
        tenantId: snapshot.tenantId,
        waUserId: snapshot.waUserId,
        waGroupId: snapshot.waGroupId,
        capability: tierCapability,
        limit,
        periodKey,
        bucket: FREE_DIRECT_CHAT_QUOTA_BUCKET,
        metadata: {
          scope: snapshot.scope,
          capability: tierCapability
        }
      });

      quotaSnapshot.used = quotaResult.used;
      quotaSnapshot.remaining = quotaResult.remaining;

      if (!quotaResult.allowed) {
        quotaSnapshot.reasonCode = "DENY_QUOTA_LIMIT";
        addDiagnostic(
          acc,
          {
            code: "DENY_QUOTA_LIMIT",
            severity: "warn",
            message: "Quota limit reached for this capability and period.",
            context: {
              bucket: quotaResult.bucket,
              periodKey: quotaResult.periodKey,
              limit: quotaResult.limit,
              used: quotaResult.used,
              remaining: quotaResult.remaining
            }
          },
          { isDeny: true }
        );
      }
    }
  }

  const allow = acc.denyCodes.size === 0;
  if (allow) {
    if (derived.isPrivileged) {
      addDiagnostic(acc, {
        code: "ALLOW_PRIVILEGED_OVERRIDE",
        severity: "info",
        message: "No blocking policy found; privileged actor context detected."
      });
    } else {
      addDiagnostic(acc, {
        code: "ALLOW_POLICY_PASSED",
        severity: "info",
        message: "No blocking governance policy matched."
      });
    }
  }

  const approvalState =
    effectiveAccess.status === "APPROVED"
      ? "approved"
      : effectiveAccess.status === "PENDING"
        ? "pending"
        : effectiveAccess.status === "BLOCKED"
          ? "rejected"
          : "not_required";
  const licensingState =
    effectiveAccess.status === "BLOCKED"
      ? "blocked"
      : effectiveAccess.tier === "UNKNOWN"
        ? "not_evaluated"
        : "active";
  const effectiveApprovedBy = snapshot.access.effective.source === "group" ? snapshot.access.group.approvedBy : snapshot.access.user.approvedBy;

  const decision: DecisionResult = {
    decision: allow ? "allow" : "deny",
    allow,
    allowedCapabilities,
    blockedByPolicy: !allow,
    blocked_by_policy: !allow,
    reasonCodes: [...acc.reasonCodes],
    diagnostics: acc.diagnostics,
    approval: {
      required: approvalState !== "not_required",
      state: approvalState,
      requestedBy: null,
      approvedBy: effectiveApprovedBy ?? null,
      referenceId: null
    },
    licensing: {
      state: licensingState,
      planId: effectiveAccess.tier === "UNKNOWN" ? null : effectiveAccess.tier,
      quota: quotaSnapshot
    },
    fallback: {
      mode: allow ? "none" : "route_default",
      reasonCode: allow ? null : [...acc.denyCodes][0] ?? null
    },
    snapshot
  };

  return decision;
};
