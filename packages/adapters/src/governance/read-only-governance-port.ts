import type { ConsentStatus } from "@zappy/core";
import type {
  DecisionInput,
  GovernancePolicySnapshot,
  GovernancePort,
  GovernanceQuotaConsumeInput,
  GovernanceQuotaConsumeResult,
  RelationshipProfile
} from "@zappy/core";

export interface GovernanceGroupSnapshotSource {
  tenantId: string;
  waGroupId: string;
  name?: string | null;
  allowed?: boolean;
  chatMode?: "on" | "off";
  botIsAdmin?: boolean | null;
  botAdminCheckedAt?: Date | null;
}

export interface GovernanceUserAccessSnapshotSource {
  tenantId: string;
  waUserId: string;
  status: "PENDING" | "APPROVED" | "BLOCKED";
  tier: "FREE" | "BASIC" | "PRO" | "ROOT";
  approvedBy?: string | null;
  approvedAt?: Date | null;
}

export interface GovernanceGroupAccessSnapshotSource {
  tenantId: string;
  waGroupId: string;
  status: "PENDING" | "APPROVED" | "BLOCKED";
  tier: "FREE" | "BASIC" | "PRO" | "ROOT";
  approvedBy?: string | null;
  approvedAt?: Date | null;
}

export interface GovernanceReadOnlySources {
  resolveFlags: (input: { tenantId: string; waGroupId?: string; waUserId: string }) => Promise<Record<string, string>>;
  readGroup: (input: { tenantId: string; waGroupId: string }) => Promise<GovernanceGroupSnapshotSource | null>;
  isBotAdmin: (input: { tenantId: string; waUserId: string }) => Promise<boolean>;
  getConsent: (input: { tenantId: string; waUserId: string; termsVersion?: string }) => Promise<{
    status: ConsentStatus;
    termsVersion: string;
  } | null>;
  readUserAccess?: (input: { tenantId: string; waUserId: string }) => Promise<GovernanceUserAccessSnapshotSource | null>;
  readGroupAccess?: (input: { tenantId: string; waGroupId: string; groupName?: string | null }) => Promise<GovernanceGroupAccessSnapshotSource | null>;
  consumeQuota?: (input: GovernanceQuotaConsumeInput) => Promise<GovernanceQuotaConsumeResult>;
  now?: () => Date;
}

const PRIVILEGED_PROFILES = new Set<RelationshipProfile>(["creator_root", "mother_privileged", "delegated_owner"]);

const isPrivilegedProfile = (profile?: RelationshipProfile | null): boolean => {
  if (!profile) return false;
  return PRIVILEGED_PROFILES.has(profile);
};

const isPrivilegedPermissionRole = (permissionRole?: string | null): boolean => {
  const normalized = (permissionRole ?? "").trim().toUpperCase();
  return normalized === "ROOT" || normalized === "DONO" || normalized === "OWNER";
};

type GovernanceAccessStatus = GovernancePolicySnapshot["access"]["effective"]["status"];
type GovernanceLicenseTier = GovernancePolicySnapshot["access"]["effective"]["tier"];

const toGovernanceAccessStatus = (value?: string | null): GovernanceAccessStatus => {
  if (value === "PENDING" || value === "APPROVED" || value === "BLOCKED") return value;
  return "UNKNOWN";
};

const toGovernanceLicenseTier = (value?: string | null): GovernanceLicenseTier => {
  if (value === "FREE" || value === "BASIC" || value === "PRO" || value === "ROOT") return value;
  return "UNKNOWN";
};

export const createReadOnlyGovernancePort = (sources: GovernanceReadOnlySources): GovernancePort => {
  const port: GovernancePort = {
    getSnapshot: async (input: DecisionInput): Promise<GovernancePolicySnapshot> => {
      const { tenant, user } = input;
      const waGroupId = input.group?.waGroupId;

      const [featureFlags, group, isBotAdmin, consent, userAccess, groupAccess] = await Promise.all([
        sources.resolveFlags({ tenantId: tenant.id, waGroupId, waUserId: user.waUserId }),
        waGroupId ? sources.readGroup({ tenantId: tenant.id, waGroupId }) : Promise.resolve(null),
        sources.isBotAdmin({ tenantId: tenant.id, waUserId: user.waUserId }),
        sources.getConsent({
          tenantId: tenant.id,
          waUserId: user.waUserId,
          termsVersion: input.consent?.termsVersion ?? undefined
        }),
        sources.readUserAccess
          ? sources.readUserAccess({
              tenantId: tenant.id,
              waUserId: user.waUserId
            })
          : Promise.resolve(null),
        waGroupId && sources.readGroupAccess
          ? sources.readGroupAccess({
              tenantId: tenant.id,
              waGroupId,
              groupName: input.group?.name
            })
          : Promise.resolve(null)
      ]);

      const isPrivileged =
        Boolean(input.user.isPrivileged) ||
        isPrivilegedPermissionRole(input.user.permissionRole) ||
        isPrivilegedProfile(input.user.relationshipProfile);

      const runtimePolicySignals = {
        ...(input.runtimePolicySignals ?? {}),
        senderIsGroupAdmin: input.user.senderIsGroupAdmin ?? null
      };

      const userAccessSnapshot = {
        exists: Boolean(userAccess),
        status: toGovernanceAccessStatus(userAccess?.status),
        tier: toGovernanceLicenseTier(userAccess?.tier),
        approvedBy: userAccess?.approvedBy ?? null,
        approvedAt: userAccess?.approvedAt ?? null,
        source: (userAccess ? "persisted" : "default") as "persisted" | "default"
      };
      const groupAccessSnapshot = {
        exists: Boolean(groupAccess),
        status: toGovernanceAccessStatus(groupAccess?.status),
        tier: toGovernanceLicenseTier(groupAccess?.tier),
        approvedBy: groupAccess?.approvedBy ?? null,
        approvedAt: groupAccess?.approvedAt ?? null,
        source: (groupAccess ? "persisted" : "default") as "persisted" | "default"
      };
      const useGroupAccess = input.context.scope === "group" && groupAccessSnapshot.exists;
      const effectiveAccess = useGroupAccess
        ? {
            source: "group" as const,
            status: groupAccessSnapshot.status,
            tier: groupAccessSnapshot.tier
          }
        : userAccessSnapshot.exists
          ? {
              source: "user" as const,
              status: userAccessSnapshot.status,
              tier: userAccessSnapshot.tier
            }
          : {
              source: "none" as const,
              status: "UNKNOWN" as const,
              tier: "UNKNOWN" as const
            };

      return {
        evaluatedAt: sources.now?.() ?? new Date(),
        tenantId: tenant.id,
        waUserId: user.waUserId,
        waGroupId,
        scope: input.context.scope,
        actor: {
          isBotAdmin: input.user.isBotAdmin === true || isBotAdmin,
          isPrivileged,
          permissionRole: input.user.permissionRole,
          relationshipProfile: input.user.relationshipProfile ?? null
        },
        featureFlags,
        group: {
          exists: Boolean(group),
          allowed: group?.allowed,
          chatMode: group?.chatMode,
          botIsAdmin: group?.botIsAdmin,
          botAdminCheckedAt: group?.botAdminCheckedAt ?? null
        },
        consent: {
          exists: Boolean(consent),
          status: consent?.status ?? "UNKNOWN",
          termsVersion: consent?.termsVersion ?? input.consent?.termsVersion ?? null
        },
        access: {
          user: userAccessSnapshot,
          group: groupAccessSnapshot,
          effective: effectiveAccess
        },
        runtimePolicySignals
      };
    }
  };

  if (sources.consumeQuota) {
    port.consumeQuota = async (input) => sources.consumeQuota!(input);
  }

  return port;
};
