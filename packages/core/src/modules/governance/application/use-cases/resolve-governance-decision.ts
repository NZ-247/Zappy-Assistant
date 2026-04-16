import type {
  DecisionInput,
  DecisionResult,
  GovernanceCapabilityDenySource,
  GovernanceLicenseTier,
  GovernancePolicyDiagnostic,
  GovernanceReasonCode,
  GovernanceRequiredRole
} from "../../domain/governance-decision.js";
import {
  createDefaultCapabilityPolicySnapshot,
  evaluateCapabilityPolicy,
  listEffectiveCapabilities,
  normalizeGovernanceCapabilityKey
} from "../../domain/capability-policy.js";
import type { GovernancePort } from "../../ports/governance.port.js";

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled", "allow", "allowed"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled", "deny", "denied"]);

const DEFAULT_FREE_DIRECT_CHAT_LIMIT = 30;
const FREE_DIRECT_CHAT_QUOTA_BUCKET = "conversation.direct.free.daily";

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

const resolvePrimaryDenySource = (input: {
  allow: boolean;
  reasonCodes: Set<GovernanceReasonCode>;
  capabilityDenySource: GovernanceCapabilityDenySource | null;
}): GovernanceCapabilityDenySource | null => {
  if (input.allow) return null;
  if (input.reasonCodes.has("DENY_ACCESS_BLOCKED") || input.reasonCodes.has("DENY_ACCESS_PENDING")) return "blocked_status";
  if (input.reasonCodes.has("DENY_QUOTA_LIMIT")) return "quota_denied";
  if (input.reasonCodes.has("DENY_LICENSE_CAPABILITY")) return input.capabilityDenySource ?? "unknown";
  if (input.reasonCodes.has("DENY_CAPABILITY_DISABLED") || input.reasonCodes.has("DENY_TENANT_POLICY")) return "policy_flag";
  return "unknown";
};

const normalizeOverrideMap = (input: Record<string, string>): Record<string, "allow" | "deny"> => {
  const out: Record<string, "allow" | "deny"> = {};
  for (const [key, raw] of Object.entries(input)) {
    const normalizedKey = normalizeGovernanceCapabilityKey(key);
    if (!normalizedKey) continue;
    const normalizedRaw = (raw ?? "").trim().toLowerCase();
    if (normalizedRaw !== "allow" && normalizedRaw !== "deny") continue;
    out[normalizedKey] = normalizedRaw;
  }
  return out;
};

const normalizePolicySnapshot = (input: DecisionResult["snapshot"]["capabilityPolicy"] | undefined) => {
  const fallback = createDefaultCapabilityPolicySnapshot();
  if (!input) return fallback;

  return {
    definitions: input.definitions?.length ? input.definitions : fallback.definitions,
    bundles: input.bundles?.length ? input.bundles : fallback.bundles,
    tierDefaultBundles: {
      FREE: input.tierDefaultBundles?.FREE?.length ? input.tierDefaultBundles.FREE : fallback.tierDefaultBundles.FREE,
      BASIC: input.tierDefaultBundles?.BASIC?.length ? input.tierDefaultBundles.BASIC : fallback.tierDefaultBundles.BASIC,
      PRO: input.tierDefaultBundles?.PRO?.length ? input.tierDefaultBundles.PRO : fallback.tierDefaultBundles.PRO,
      ROOT: input.tierDefaultBundles?.ROOT?.length ? input.tierDefaultBundles.ROOT : fallback.tierDefaultBundles.ROOT
    },
    assignments: {
      user: input.assignments?.user ?? [],
      group: input.assignments?.group ?? []
    },
    overrides: {
      user: normalizeOverrideMap(input.overrides?.user ?? {}),
      group: normalizeOverrideMap(input.overrides?.group ?? {})
    }
  };
};

const normalizeTier = (value: GovernanceLicenseTier): GovernanceLicenseTier => {
  if (value === "FREE" || value === "BASIC" || value === "PRO" || value === "ROOT") return value;
  return "UNKNOWN";
};

export const resolveGovernanceDecision = async (governancePort: GovernancePort, input: DecisionInput): Promise<DecisionResult> => {
  const snapshot = await governancePort.getSnapshot(input);
  const flagIndex = buildFeatureFlagIndex(snapshot.featureFlags);
  const capability = normalizeGovernanceCapabilityKey(input.request.capability);
  const effectiveAccess = snapshot.access.effective;
  const normalizedPolicySnapshot = normalizePolicySnapshot(snapshot.capabilityPolicy);

  const policyCapabilityEvaluation = evaluateCapabilityPolicy({
    policy: normalizedPolicySnapshot,
    capability,
    tier: normalizeTier(effectiveAccess.tier),
    scope: input.context.scope
  });

  const allowedCapabilitiesSet = new Set(
    listEffectiveCapabilities({
      policy: normalizedPolicySnapshot,
      tier: normalizeTier(effectiveAccess.tier),
      scope: input.context.scope
    })
      .filter((item) => item.allow)
      .map((item) => item.key)
  );

  for (const [key, rawValue] of flagIndex.entries()) {
    if (!key.startsWith("capability.") || !key.endsWith(".enabled")) continue;
    const capabilityKey = key.slice("capability.".length, -".enabled".length).trim();
    if (!capabilityKey) continue;
    const normalized = normalizeGovernanceCapabilityKey(capabilityKey.replace(/_/g, "."));
    if (!normalized) continue;
    const parsed = parseBooleanFlag(rawValue);
    if (parsed === false) allowedCapabilitiesSet.delete(normalized);
    if (parsed === true) allowedCapabilitiesSet.add(normalized);
  }

  const allowedCapabilities = [...allowedCapabilitiesSet].sort((a, b) => a.localeCompare(b));

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

  if (policyCapabilityEvaluation.governed && !policyCapabilityEvaluation.allow) {
    addDiagnostic(
      acc,
      {
        code: "DENY_LICENSE_CAPABILITY",
        severity: "error",
        message: "Capability is not available for the current effective capability policy.",
        context: {
          capability,
          tier: effectiveAccess.tier,
          denySource: policyCapabilityEvaluation.denySource,
          tierDefaultAllowed: policyCapabilityEvaluation.tierDefaultAllowed,
          bundleAllowed: policyCapabilityEvaluation.bundleAllowed,
          matchedBundleKeys: policyCapabilityEvaluation.matchedBundleKeys,
          explicitAllowSource: policyCapabilityEvaluation.explicitAllowSource,
          explicitDenySources: policyCapabilityEvaluation.explicitDenySources
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

  if (!skipQuotaConsumption && acc.denyCodes.size === 0 && capability === "conversation.direct" && input.context.scope === "private" && effectiveAccess.tier === "FREE") {
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
        capability,
        limit,
        periodKey,
        bucket: FREE_DIRECT_CHAT_QUOTA_BUCKET,
        metadata: {
          scope: snapshot.scope,
          capability
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

  const primaryDenySource = resolvePrimaryDenySource({
    allow,
    reasonCodes: acc.reasonCodes,
    capabilityDenySource: policyCapabilityEvaluation.denySource
  });

  const decision: DecisionResult = {
    decision: allow ? "allow" : "deny",
    allow,
    allowedCapabilities,
    blockedByPolicy: !allow,
    blocked_by_policy: !allow,
    reasonCodes: [...acc.reasonCodes],
    diagnostics: acc.diagnostics,
    primaryDenySource,
    capabilityPolicy: {
      requested: capability,
      governed: policyCapabilityEvaluation.governed,
      tierDefaultAllowed: policyCapabilityEvaluation.tierDefaultAllowed,
      bundleAllowed: policyCapabilityEvaluation.bundleAllowed,
      matchedBundleKeys: policyCapabilityEvaluation.matchedBundleKeys,
      effectiveBundleKeys: policyCapabilityEvaluation.effectiveBundleKeys,
      explicitAllowSource: policyCapabilityEvaluation.explicitAllowSource,
      explicitDenySources: policyCapabilityEvaluation.explicitDenySources,
      decisionSource: policyCapabilityEvaluation.decisionSource,
      denySource: policyCapabilityEvaluation.denySource
    },
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
    snapshot: {
      ...snapshot,
      capabilityPolicy: normalizedPolicySnapshot
    }
  };

  return decision;
};
