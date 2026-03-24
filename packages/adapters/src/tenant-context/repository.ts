import { ChatMode, type PrismaClient } from "@prisma/client";
import type { CanonicalIdentity, RelationshipProfile } from "@zappy/core";
import type { CollectAliasesFn, ResolveCanonicalUserIdentityFn } from "../identity/canonical-identity.js";

interface TenantContextRepositoryDeps {
  prisma: PrismaClient;
  resolveCanonicalUserIdentity: ResolveCanonicalUserIdentityFn;
  collectAliases: CollectAliasesFn;
  identityLogger?: {
    debug?: (payload: unknown, message?: string) => void;
  };
}

export type EnsureTenantContextInput = {
  waGroupId?: string;
  waUserId: string;
  defaultTenantName: string;
  onlyGroupId?: string;
  remoteJid?: string;
  userName?: string | null;
};

export type EnsureTenantContextResult = {
  tenant: any;
  group: any;
  user: any;
  canonicalIdentity: CanonicalIdentity;
  relationshipProfile?: RelationshipProfile;
  relationshipReason?: string;
  permissionRoleSource?: string;
};

export const createTenantContextRepository = (deps: TenantContextRepositoryDeps) => {
  const { prisma, resolveCanonicalUserIdentity, collectAliases, identityLogger } = deps;

  const ensureTenantContext = async (input: EnsureTenantContextInput): Promise<EnsureTenantContextResult> => {
    let tenant = await prisma.tenant.findFirst({ where: { name: input.defaultTenantName } });
    if (!tenant) tenant = await prisma.tenant.create({ data: { name: input.defaultTenantName } });

    let group = input.waGroupId
      ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } })
      : input.onlyGroupId
        ? await prisma.group.findUnique({ where: { waGroupId: input.onlyGroupId } })
        : null;

    if (!group && (input.waGroupId || input.onlyGroupId)) {
      const waGroupId = input.waGroupId ?? input.onlyGroupId!;
      const shouldAutoAllow = Boolean(input.onlyGroupId && input.onlyGroupId === waGroupId);
      group = await prisma.group.create({
        data: {
          tenantId: tenant.id,
          waGroupId,
          name: waGroupId,
          allowed: shouldAutoAllow,
          chatMode: ChatMode.ON,
          isOpen: true,
          welcomeEnabled: false,
          moderationConfig: {}
        }
      });
    }

    const resolvedIdentity = await resolveCanonicalUserIdentity({
      tenantId: tenant.id,
      waUserId: input.waUserId,
      remoteJid: input.remoteJid,
      displayName: input.userName,
      aliases: collectAliases(input.userName)
    });

    const user =
      resolvedIdentity.user ??
      (await prisma.user.create({
        data: {
          tenantId: tenant.id,
          waUserId: input.waUserId,
          displayName: input.userName ?? input.waUserId,
          role: "member"
        }
      }));

    if (process.env.NODE_ENV !== "production") {
      const relationshipSource =
        resolvedIdentity.relationshipReason?.startsWith("match:")
          ? "privileged_override"
          : resolvedIdentity.relationshipReason === "stored_profile"
            ? "db"
            : resolvedIdentity.relationshipReason?.startsWith("role:")
              ? "role"
              : "default";
      const permissionRoleSource = resolvedIdentity.permissionRoleSource ?? (resolvedIdentity.canonical.permissionRole ? "db" : "none");
      const permissionRole = resolvedIdentity.canonical.permissionRole ?? user.permissionRole ?? user.role;
      const relationshipProfile = resolvedIdentity.relationship ?? resolvedIdentity.canonical.relationshipProfile ?? null;
      identityLogger?.debug?.(
        {
          stage: "ensureTenantContext",
          tenantId: tenant.id,
          waUserId: input.waUserId,
          phoneNumber: resolvedIdentity.canonical.phoneNumber,
          pnJid: resolvedIdentity.canonical.pnJid,
          lidJid: resolvedIdentity.canonical.lidJid,
          relationshipProfile,
          relationshipReason: resolvedIdentity.relationshipReason,
          relationshipSource,
          permissionRole,
          permissionRoleSource,
          matchedPrivilegedRule: resolvedIdentity.relationshipReason?.startsWith("match:") ?? false,
          updatedFields: resolvedIdentity.updatedFields,
          created: resolvedIdentity.created
        },
        "identity resolved"
      );
    }

    return {
      tenant,
      group,
      user,
      canonicalIdentity: resolvedIdentity.canonical,
      relationshipProfile: resolvedIdentity.relationship,
      relationshipReason: resolvedIdentity.relationshipReason,
      permissionRoleSource: resolvedIdentity.permissionRoleSource
    };
  };

  return {
    ensureTenantContext
  };
};
