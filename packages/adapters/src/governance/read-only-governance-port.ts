import type { ConsentStatus } from "@zappy/core";
import type { DecisionInput, GovernancePolicySnapshot, GovernancePort, RelationshipProfile } from "@zappy/core";

export interface GovernanceGroupSnapshotSource {
  tenantId: string;
  waGroupId: string;
  name?: string | null;
  allowed?: boolean;
  chatMode?: "on" | "off";
  botIsAdmin?: boolean | null;
  botAdminCheckedAt?: Date | null;
}

export interface GovernanceReadOnlySources {
  resolveFlags: (input: { tenantId: string; waGroupId?: string; waUserId: string }) => Promise<Record<string, string>>;
  readGroup: (input: { tenantId: string; waGroupId: string }) => Promise<GovernanceGroupSnapshotSource | null>;
  isBotAdmin: (input: { tenantId: string; waUserId: string }) => Promise<boolean>;
  getConsent: (input: { tenantId: string; waUserId: string; termsVersion?: string }) => Promise<{
    status: ConsentStatus;
    termsVersion: string;
  } | null>;
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

export const createReadOnlyGovernancePort = (sources: GovernanceReadOnlySources): GovernancePort => {
  return {
    getSnapshot: async (input: DecisionInput): Promise<GovernancePolicySnapshot> => {
      const { tenant, user } = input;
      const waGroupId = input.group?.waGroupId;

      const [featureFlags, group, isBotAdmin, consent] = await Promise.all([
        sources.resolveFlags({ tenantId: tenant.id, waGroupId, waUserId: user.waUserId }),
        waGroupId ? sources.readGroup({ tenantId: tenant.id, waGroupId }) : Promise.resolve(null),
        sources.isBotAdmin({ tenantId: tenant.id, waUserId: user.waUserId }),
        sources.getConsent({
          tenantId: tenant.id,
          waUserId: user.waUserId,
          termsVersion: input.consent?.termsVersion ?? undefined
        })
      ]);

      const isPrivileged =
        Boolean(input.user.isPrivileged) ||
        isPrivilegedPermissionRole(input.user.permissionRole) ||
        isPrivilegedProfile(input.user.relationshipProfile);

      const runtimePolicySignals = {
        ...(input.runtimePolicySignals ?? {}),
        senderIsGroupAdmin: input.user.senderIsGroupAdmin ?? null
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
        runtimePolicySignals
      };
    }
  };
};
