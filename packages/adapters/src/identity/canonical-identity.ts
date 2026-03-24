import { type Prisma, type PrismaClient, type User } from "@prisma/client";
import { resolveRelationshipProfile, type CanonicalIdentity, type RelationshipProfile } from "@zappy/core";

export type DerivedIdentity = {
  waUserId: string;
  phoneNumber?: string | null;
  lidJid?: string | null;
  pnJid?: string | null;
};

export type ResolveCanonicalUserIdentityInput = {
  tenantId: string;
  waUserId: string;
  remoteJid?: string;
  displayName?: string | null;
  aliases?: string[];
  allowCreate?: boolean;
};

export type ResolveCanonicalUserIdentityResult = {
  user: User | null;
  canonical: CanonicalIdentity;
  created: boolean;
  updatedFields: string[];
  relationship?: RelationshipProfile;
  relationshipReason?: string;
  permissionRoleSource?: string;
};

export type FindUserByAnyIdentifierFn = (tenantId: string, identifiers: DerivedIdentity, aliases: string[]) => Promise<User | null>;
export type FindUserForTenantFn = (tenantId: string, waUserId: string, remoteJid?: string) => Promise<User | null>;
export type ResolveCanonicalUserIdentityFn = (input: ResolveCanonicalUserIdentityInput) => Promise<ResolveCanonicalUserIdentityResult>;
export type BuildCanonicalIdentityFn = (user: User, derived: DerivedIdentity, extraAliases?: string[]) => CanonicalIdentity;
export type CollectAliasesFn = (...values: Array<string | null | undefined>) => string[];
export type NormalizePhoneNumberFn = (value?: string | null) => string | null;
export type NormalizeLidJidFn = (value?: string | null) => string | null;
export type ToRelationshipProfileFn = (value?: string | null) => RelationshipProfile | null;

const aliasSeeds: Array<{ lidJid: string; phoneNumber: string; label: string }> = [
  { lidJid: "70029643092123@lid", phoneNumber: "556699064658", label: "creator_root" },
  { lidJid: "151608402911288@lid", phoneNumber: "556692283438", label: "mother_privileged" }
];

const parsePhoneFromJid = (jid?: string | null, normalizePhoneNumber?: NormalizePhoneNumberFn): string | null => {
  if (!jid) return null;
  const match = jid.match(/^(\d+)/);
  if (match?.[1]) return normalizePhoneNumber?.(match[1]) ?? match[1];
  return null;
};

const extractIdentityParts = (waUserId: string, remoteJid: string | undefined, normalizePhoneNumber: NormalizePhoneNumberFn): DerivedIdentity => {
  const lidJid = waUserId?.endsWith?.("@lid") ? waUserId : remoteJid?.endsWith?.("@lid") ? remoteJid : null;
  const pnJidRaw =
    waUserId?.includes("@s.whatsapp.net") || waUserId?.includes("@c.us")
      ? waUserId
      : remoteJid?.includes?.("@s.whatsapp.net") || remoteJid?.includes?.("@c.us")
        ? remoteJid
        : null;
  const phoneFromId = normalizePhoneNumber(parsePhoneFromJid(pnJidRaw ?? waUserId, normalizePhoneNumber));
  const pnJid = phoneFromId ? `${phoneFromId}@s.whatsapp.net` : pnJidRaw;
  return {
    waUserId,
    phoneNumber: phoneFromId,
    lidJid,
    pnJid
  };
};

const applyAliasSeed = (
  derived: DerivedIdentity,
  normalizeLidJid: NormalizeLidJidFn
): { applied: boolean; seedLabel?: string } => {
  if (derived.phoneNumber) return { applied: false };
  const lid = normalizeLidJid(derived.lidJid ?? derived.waUserId);
  if (!lid) return { applied: false };
  const match = aliasSeeds.find((seed) => seed.lidJid === lid);
  if (!match) return { applied: false };
  derived.phoneNumber = match.phoneNumber;
  derived.pnJid = `${match.phoneNumber}@s.whatsapp.net`;
  derived.lidJid = lid;
  return { applied: true, seedLabel: match.label };
};

const mergeUserIdentity = async (
  prisma: PrismaClient,
  user: User,
  derived: DerivedIdentity,
  aliases: string[],
  displayName?: string | null
) => {
  const updates: Prisma.UserUpdateInput = {};
  const updatedFields: string[] = [];
  if (displayName && !user.displayName) {
    updates.displayName = displayName;
    updatedFields.push("displayName");
  }
  if (derived.phoneNumber && !user.phoneNumber) {
    updates.phoneNumber = derived.phoneNumber;
    updatedFields.push("phoneNumber");
  }
  const normalizedPnJid = derived.phoneNumber ? `${derived.phoneNumber}@s.whatsapp.net` : derived.pnJid ?? null;
  if (normalizedPnJid && !user.pnJid) {
    updates.pnJid = normalizedPnJid;
    updatedFields.push("pnJid");
  }
  if (derived.lidJid && !user.lidJid) {
    updates.lidJid = derived.lidJid;
    updatedFields.push("lidJid");
  }
  const mergedAliases = Array.from(new Set([...(user.aliases ?? []), ...aliases]));
  if (mergedAliases.length !== (user.aliases?.length ?? 0)) {
    updates.aliases = mergedAliases;
    updatedFields.push("aliases");
  }

  if (Object.keys(updates).length > 0) {
    const updated = await prisma.user.update({ where: { id: user.id }, data: updates });
    return { user: updated, updatedFields };
  }
  return { user, updatedFields };
};

export const createCanonicalIdentityServices = (deps: { prisma: PrismaClient }) => {
  const { prisma } = deps;

  const normalizePhoneNumber: NormalizePhoneNumberFn = (value?: string | null): string | null => {
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    return digits.length ? digits : null;
  };

  const normalizeLidJid: NormalizeLidJidFn = (value?: string | null): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.includes("@") ? trimmed : `${trimmed}@lid`;
  };

  const collectAliases: CollectAliasesFn = (...values: Array<string | null | undefined>): string[] => {
    const set = new Set<string>();
    for (const value of values) {
      if (value && value.trim()) set.add(value.trim());
    }
    return Array.from(set);
  };

  const toRelationshipProfile: ToRelationshipProfileFn = (value?: string | null): RelationshipProfile | null => {
    const allowed: RelationshipProfile[] = [
      "creator_root",
      "mother_privileged",
      "delegated_owner",
      "admin",
      "member",
      "external_contact"
    ];
    if (!value) return null;
    return allowed.includes(value as RelationshipProfile) ? (value as RelationshipProfile) : null;
  };

  const buildCanonicalIdentity: BuildCanonicalIdentityFn = (
    user: User,
    derived: DerivedIdentity,
    extraAliases: string[] = []
  ): CanonicalIdentity => {
    const phoneNumber = user.phoneNumber ?? derived.phoneNumber ?? null;
    const lidJid = user.lidJid ?? derived.lidJid ?? null;
    const pnJid = user.pnJid ?? (phoneNumber ? `${phoneNumber}@s.whatsapp.net` : derived.pnJid ?? null);
    const aliases = collectAliases(
      ...extraAliases,
      user.waUserId,
      lidJid,
      pnJid,
      phoneNumber,
      derived.waUserId,
      derived.lidJid,
      derived.pnJid,
      derived.phoneNumber
    );
    const canonicalUserKey = phoneNumber ?? lidJid ?? pnJid ?? user.waUserId;
    return {
      canonicalUserKey,
      waUserId: user.waUserId,
      phoneNumber,
      lidJid,
      pnJid,
      aliases,
      displayName: user.displayName ?? null,
      permissionRole: user.permissionRole ?? null,
      relationshipProfile: toRelationshipProfile(user.relationshipProfile)
    };
  };

  const findUserByAnyIdentifier: FindUserByAnyIdentifierFn = async (
    tenantId: string,
    identifiers: DerivedIdentity,
    aliases: string[]
  ): Promise<User | null> => {
    const prioritizedFilters: Array<Prisma.UserWhereInput | null> = [
      identifiers.phoneNumber ? { phoneNumber: identifiers.phoneNumber } : null,
      identifiers.pnJid ? { pnJid: identifiers.pnJid } : null,
      identifiers.lidJid ? { lidJid: identifiers.lidJid } : null,
      aliases.length > 0 ? { aliases: { hasSome: aliases } } : null,
      identifiers.waUserId ? { waUserId: identifiers.waUserId } : null
    ];

    for (const filter of prioritizedFilters) {
      if (!filter) continue;
      const user = await prisma.user.findFirst({ where: { tenantId, ...filter } });
      if (user) return user;
    }
    return null;
  };

  const findUserForTenant: FindUserForTenantFn = async (tenantId: string, waUserId: string, remoteJid?: string) => {
    const derived = extractIdentityParts(waUserId, remoteJid, normalizePhoneNumber);
    const aliases = collectAliases(
      waUserId,
      derived.pnJid,
      derived.lidJid,
      derived.phoneNumber,
      derived.phoneNumber ? `${derived.phoneNumber}@s.whatsapp.net` : null
    );
    return findUserByAnyIdentifier(tenantId, derived, aliases);
  };

  const resolveCanonicalUserIdentity: ResolveCanonicalUserIdentityFn = async (
    input: ResolveCanonicalUserIdentityInput
  ): Promise<ResolveCanonicalUserIdentityResult> => {
    const derived = extractIdentityParts(input.waUserId, input.remoteJid, normalizePhoneNumber);
    applyAliasSeed(derived, normalizeLidJid);
    const aliasCandidates = collectAliases(
      ...collectAliases(derived.waUserId, derived.lidJid, derived.pnJid, derived.phoneNumber),
      ...(input.aliases ?? []),
      derived.phoneNumber ? `${derived.phoneNumber}@s.whatsapp.net` : null
    );

    let user = await findUserByAnyIdentifier(input.tenantId, derived, aliasCandidates);
    let created = false;

    if (!user && input.allowCreate !== false) {
      const pnJid = derived.pnJid ?? (derived.phoneNumber ? `${derived.phoneNumber}@s.whatsapp.net` : null);
      user = await prisma.user.create({
        data: {
          tenantId: input.tenantId,
          waUserId: derived.waUserId,
          displayName: input.displayName ?? derived.phoneNumber ?? derived.waUserId,
          phoneNumber: derived.phoneNumber,
          lidJid: derived.lidJid,
          pnJid,
          aliases: aliasCandidates,
          role: "member"
        }
      });
      created = true;
    }

    if (!user) {
      const canonicalUserKey = derived.phoneNumber ?? derived.lidJid ?? derived.pnJid ?? derived.waUserId;
      return {
        user: null,
        canonical: {
          canonicalUserKey,
          waUserId: derived.waUserId,
          phoneNumber: derived.phoneNumber ?? null,
          lidJid: derived.lidJid ?? null,
          pnJid: derived.pnJid ?? null,
          aliases: aliasCandidates,
          displayName: input.displayName ?? null,
          permissionRole: null,
          relationshipProfile: null
        },
        created,
        updatedFields: [],
        relationship: undefined
      };
    }

    const mergeResult = await mergeUserIdentity(prisma, user, derived, aliasCandidates, input.displayName);
    user = mergeResult.user;

    const canonical = buildCanonicalIdentity(user, derived, aliasCandidates);
    const storedRelationshipProfile = toRelationshipProfile(user.relationshipProfile);
    const storedPermissionRole = user.permissionRole ?? null;
    const relationship = resolveRelationshipProfile({
      waUserId: canonical.waUserId,
      phoneNumber: canonical.phoneNumber,
      pnJid: canonical.pnJid,
      lidJid: canonical.lidJid,
      aliases: canonical.aliases,
      storedProfile: storedRelationshipProfile,
      identityRole: user.permissionRole ?? user.role
    });

    const privilegedPermissionRole =
      relationship.profile === "creator_root"
        ? "ROOT"
        : relationship.profile === "mother_privileged"
          ? "PRIVILEGED"
          : null;
    const permissionRoleTarget = privilegedPermissionRole ?? storedPermissionRole ?? null;

    const updates: Prisma.UserUpdateInput = {};
    const updatedFields = [...mergeResult.updatedFields];
    const shouldPersistRelationship =
      (!user.relationshipProfile || toRelationshipProfile(user.relationshipProfile) !== relationship.profile) &&
      relationship.reason !== "stored_profile";
    if (shouldPersistRelationship) {
      updates.relationshipProfile = relationship.profile;
      canonical.relationshipProfile = relationship.profile;
    } else {
      canonical.relationshipProfile = storedRelationshipProfile ?? relationship.profile;
    }
    const shouldUpdatePermission = permissionRoleTarget !== null && permissionRoleTarget !== storedPermissionRole;
    if (shouldUpdatePermission) {
      updates.permissionRole = permissionRoleTarget;
      canonical.permissionRole = permissionRoleTarget;
    }
    if (Object.keys(updates).length > 0) {
      user = await prisma.user.update({ where: { id: user.id }, data: updates });
      updatedFields.push(...Object.keys(updates));
    } else if (!canonical.permissionRole) {
      canonical.permissionRole = storedPermissionRole;
    }

    return {
      user,
      canonical,
      created,
      updatedFields,
      relationship: relationship.profile,
      relationshipReason: relationship.reason,
      permissionRoleSource: shouldUpdatePermission
        ? "privileged_override"
        : storedPermissionRole
          ? "stored_permission_role"
          : permissionRoleTarget
            ? "inferred_from_privileged_profile"
            : "none"
    };
  };

  return {
    collectAliases,
    normalizePhoneNumber,
    normalizeLidJid,
    toRelationshipProfile,
    buildCanonicalIdentity,
    findUserByAnyIdentifier,
    findUserForTenant,
    resolveCanonicalUserIdentity
  };
};
