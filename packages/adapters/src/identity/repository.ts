import { AuditAction, type Prisma, type PrismaClient } from "@prisma/client";
import { resolveRelationshipProfile } from "@zappy/core";
import type {
  BuildCanonicalIdentityFn,
  CollectAliasesFn,
  FindUserByAnyIdentifierFn,
  NormalizeLidJidFn,
  NormalizePhoneNumberFn,
  ResolveCanonicalUserIdentityFn,
  ToRelationshipProfileFn
} from "./canonical-identity.js";

interface IdentityRepositoryDeps {
  prisma: PrismaClient;
  writeAudit: (actor: string, action: AuditAction, entity: string, entityId: string, metadata?: unknown) => Promise<void>;
  resolveCanonicalUserIdentity: ResolveCanonicalUserIdentityFn;
  findUserByAnyIdentifier: FindUserByAnyIdentifierFn;
  buildCanonicalIdentity: BuildCanonicalIdentityFn;
  normalizePhoneNumber: NormalizePhoneNumberFn;
  normalizeLidJid: NormalizeLidJidFn;
  collectAliases: CollectAliasesFn;
  toRelationshipProfile: ToRelationshipProfileFn;
  identityLogger?: {
    debug?: (payload: unknown, message?: string) => void;
  };
}

const mergeUsers = async (prisma: PrismaClient, sourceId: string, targetId: string) => {
  if (sourceId === targetId) return;
  await prisma.$transaction([
    prisma.message.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.reminder.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.featureFlag.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.trigger.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.task.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.note.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.timer.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
    prisma.user.delete({ where: { id: sourceId } })
  ]);
};

export const createIdentityRepository = (deps: IdentityRepositoryDeps) => {
  const {
    prisma,
    writeAudit,
    resolveCanonicalUserIdentity,
    findUserByAnyIdentifier,
    buildCanonicalIdentity,
    normalizePhoneNumber,
    normalizeLidJid,
    collectAliases,
    toRelationshipProfile,
    identityLogger
  } = deps;

  return {
    getIdentity: async (input: { tenantId: string; waUserId: string; waGroupId?: string }) => {
      const resolved = await resolveCanonicalUserIdentity({
        tenantId: input.tenantId,
        waUserId: input.waUserId,
        remoteJid: input.waGroupId,
        allowCreate: false
      });
      const user = resolved.user;
      const group = input.waGroupId ? await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } }) : null;
      const role = user?.role ?? "member";
      const permissionRole = resolved.canonical.permissionRole ?? user?.permissionRole ?? null;
      const basePermissions = ["task", "reminder", "note", "agenda", "calc", "timer", "status"];
      const adminPermissions = ["admin:flags", "admin:triggers", "admin:status"];
      const effectiveRole = (permissionRole ?? role)?.toLowerCase?.() ?? "member";
      const elevated = ["admin", "root", "owner"].includes(effectiveRole);
      const permissions = elevated ? [...basePermissions, ...adminPermissions] : basePermissions;
      const canonical = resolved.canonical;
      const relationship =
        resolved.relationship && resolved.relationshipReason
          ? { profile: resolved.relationship, reason: resolved.relationshipReason }
          : resolveRelationshipProfile({
              waUserId: canonical.waUserId,
              phoneNumber: canonical.phoneNumber,
              pnJid: canonical.pnJid,
              lidJid: canonical.lidJid,
              aliases: canonical.aliases,
              storedProfile: canonical.relationshipProfile ?? null,
              identityRole: permissionRole ?? role
            });

      if (process.env.NODE_ENV !== "production") {
        const relationshipSource =
          relationship.reason?.startsWith("match:")
            ? "privileged_override"
            : relationship.reason === "stored_profile"
              ? "db"
              : relationship.reason?.startsWith("role:")
                ? "role"
                : "default";
        const permissionRoleSource = resolved.permissionRoleSource ?? (permissionRole ? "db" : "none");
        identityLogger?.debug?.(
          {
            stage: "identityRepository.getIdentity",
            tenantId: input.tenantId,
            waUserId: input.waUserId,
            phoneNumber: canonical.phoneNumber,
            pnJid: canonical.pnJid,
            lidJid: canonical.lidJid,
            relationshipProfile: relationship.profile,
            relationshipReason: relationship.reason,
            relationshipSource,
            permissionRole,
            permissionRoleSource,
            matchedPrivilegedRule: relationship.reason?.startsWith("match:") ?? false,
            updatedFields: resolved.updatedFields,
            created: resolved.created
          },
          "identity resolved"
        );
      }

      return {
        displayName: user?.displayName ?? canonical.displayName ?? canonical.phoneNumber ?? canonical.waUserId,
        role,
        permissionRole,
        permissions,
        groupName: group?.name,
        canonicalIdentity: { ...canonical, relationshipProfile: relationship.profile },
        relationshipProfile: relationship.profile,
        relationshipReason: relationship.reason
      };
    },
    linkAlias: async (input: { tenantId: string; phoneNumber: string; lidJid: string; actor?: string }) => {
      const phoneNumber = normalizePhoneNumber(input.phoneNumber);
      if (!phoneNumber) throw new Error("Invalid phone number");
      const lidJid = normalizeLidJid(input.lidJid);
      if (!lidJid) throw new Error("Invalid LID identifier");
      const pnJid = `${phoneNumber}@s.whatsapp.net`;
      const aliasTokens = collectAliases(lidJid, pnJid, phoneNumber, input.phoneNumber, `${phoneNumber}@c.us`);

      const phoneDerived = { waUserId: pnJid, phoneNumber, pnJid, lidJid };
      let targetUser =
        (await findUserByAnyIdentifier(input.tenantId, phoneDerived, aliasTokens)) ??
        (await prisma.user.create({
          data: {
            tenantId: input.tenantId,
            waUserId: pnJid,
            phoneNumber,
            pnJid,
            lidJid: null,
            aliases: aliasTokens,
            role: "member",
            displayName: phoneNumber
          }
        }));

      const lidUser = await findUserByAnyIdentifier(
        input.tenantId,
        { waUserId: lidJid, phoneNumber: null, pnJid: null, lidJid },
        aliasTokens
      );

      if (lidUser && lidUser.id !== targetUser.id) {
        await mergeUsers(prisma, lidUser.id, targetUser.id);
      }

      const mergedAliases = Array.from(new Set([...(targetUser.aliases ?? []), ...(lidUser?.aliases ?? []), ...aliasTokens]));
      const updates: Prisma.UserUpdateInput = {};
      if (!targetUser.phoneNumber) updates.phoneNumber = phoneNumber;
      if (!targetUser.pnJid) updates.pnJid = pnJid;
      if (!targetUser.lidJid) updates.lidJid = lidJid;
      updates.aliases = mergedAliases;
      if (!targetUser.displayName) updates.displayName = phoneNumber;

      const resolvedPhoneNumber = targetUser.phoneNumber ?? phoneNumber;
      const resolvedPnJid = targetUser.pnJid ?? pnJid;
      const resolvedLidJid = targetUser.lidJid ?? lidJid;

      const relationship = resolveRelationshipProfile({
        waUserId: targetUser.waUserId,
        phoneNumber: resolvedPhoneNumber,
        pnJid: resolvedPnJid,
        lidJid: resolvedLidJid,
        aliases: mergedAliases,
        storedProfile: toRelationshipProfile(targetUser.relationshipProfile),
        identityRole: targetUser.permissionRole ?? targetUser.role
      });
      const privilegedPermissionRole =
        relationship.profile === "creator_root"
          ? "ROOT"
          : relationship.profile === "mother_privileged"
            ? "PRIVILEGED"
            : null;
      const permissionRoleTarget = privilegedPermissionRole ?? targetUser.permissionRole ?? null;

      if (!targetUser.relationshipProfile || toRelationshipProfile(targetUser.relationshipProfile) !== relationship.profile) {
        updates.relationshipProfile = relationship.profile;
      }
      if (permissionRoleTarget && targetUser.permissionRole !== permissionRoleTarget) {
        updates.permissionRole = permissionRoleTarget;
      }

      const updatedUser =
        Object.keys(updates).length > 0 ? await prisma.user.update({ where: { id: targetUser.id }, data: updates }) : targetUser;

      const canonical = buildCanonicalIdentity(updatedUser, { ...phoneDerived, waUserId: updatedUser.waUserId });
      canonical.permissionRole = updatedUser.permissionRole ?? canonical.permissionRole;
      canonical.relationshipProfile = toRelationshipProfile(updatedUser.relationshipProfile) ?? canonical.relationshipProfile;

      await writeAudit(input.actor ?? "system", AuditAction.UPDATE, "User", updatedUser.id, {
        action: "link_alias",
        phoneNumber,
        lidJid
      });

      return {
        user: updatedUser,
        canonicalIdentity: canonical,
        relationshipProfile: canonical.relationshipProfile ?? relationship.profile,
        permissionRole: canonical.permissionRole ?? permissionRoleTarget ?? null
      };
    }
  };
};
