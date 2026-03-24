import { AuditAction, type PrismaClient, type User } from "@prisma/client";

interface BotAdminRepositoryDeps {
  prisma: PrismaClient;
  writeAudit: (actor: string, action: AuditAction, entity: string, entityId: string, metadata?: unknown) => Promise<void>;
  resolveCanonicalUserIdentity: (input: {
    tenantId: string;
    waUserId: string;
    displayName?: string | null;
  }) => Promise<{ user: User | null }>;
  findUserForTenant: (tenantId: string, waUserId: string) => Promise<User | null>;
}

export const createBotAdminRepository = (deps: BotAdminRepositoryDeps) => {
  const { prisma, writeAudit, resolveCanonicalUserIdentity, findUserForTenant } = deps;

  return {
    add: async (input: { tenantId: string; waUserId: string; displayName?: string | null; actor?: string }) => {
      const resolved = await resolveCanonicalUserIdentity({
        tenantId: input.tenantId,
        waUserId: input.waUserId,
        displayName: input.displayName ?? input.waUserId
      });
      const user =
        resolved.user ??
        (await prisma.user.create({
          data: {
            tenantId: input.tenantId,
            waUserId: input.waUserId,
            displayName: input.displayName ?? input.waUserId,
            role: "member"
          }
        }));

      await prisma.botAdmin.upsert({
        where: { tenantId_waUserId: { tenantId: input.tenantId, waUserId: user.waUserId } },
        update: { userId: user.id },
        create: { tenantId: input.tenantId, userId: user.id, waUserId: user.waUserId }
      });

      const currentRole = (user.permissionRole ?? user.role ?? "").toUpperCase();
      if (!["ROOT", "DONO", "OWNER"].includes(currentRole)) {
        await prisma.user.update({ where: { id: user.id }, data: { permissionRole: "ADMIN" } });
      }

      await writeAudit(input.actor ?? "system", AuditAction.UPDATE, "BotAdmin", user.id, { action: "add_admin", waUserId: user.waUserId });

      return {
        waUserId: user.waUserId,
        displayName: user.displayName ?? user.waUserId,
        phoneNumber: user.phoneNumber,
        permissionRole: currentRole && currentRole !== "MEMBER" ? currentRole : "ADMIN"
      };
    },

    remove: async (input: { tenantId: string; waUserId: string; actor?: string }) => {
      const entry = await prisma.botAdmin.findUnique({ where: { tenantId_waUserId: { tenantId: input.tenantId, waUserId: input.waUserId } } });
      if (!entry) return false;
      await prisma.botAdmin.delete({ where: { id: entry.id } });

      const user = await prisma.user.findUnique({ where: { id: entry.userId } });
      if (user && (user.permissionRole ?? "").toUpperCase() === "ADMIN") {
        await prisma.user.update({ where: { id: user.id }, data: { permissionRole: null } });
      }

      await writeAudit(input.actor ?? "system", AuditAction.UPDATE, "BotAdmin", entry.id, { action: "remove_admin", waUserId: input.waUserId });
      return true;
    },

    list: async (tenantId: string) => {
      const admins = await prisma.botAdmin.findMany({ where: { tenantId }, include: { user: true }, orderBy: { createdAt: "asc" } });
      return admins.map((admin) => ({
        waUserId: admin.waUserId,
        displayName: admin.user?.displayName ?? admin.waUserId,
        phoneNumber: admin.user?.phoneNumber,
        permissionRole: admin.user?.permissionRole ?? admin.user?.role ?? "member",
        createdAt: admin.createdAt
      }));
    },

    isAdmin: async (input: { tenantId: string; waUserId: string }) => {
      const adminEntry = await prisma.botAdmin.findUnique({ where: { tenantId_waUserId: { tenantId: input.tenantId, waUserId: input.waUserId } } });
      if (adminEntry) return true;
      const user = await findUserForTenant(input.tenantId, input.waUserId);
      const role = (user?.permissionRole ?? user?.role ?? "").toUpperCase();
      return ["ADMIN", "ROOT", "DONO", "OWNER"].includes(role);
    }
  };
};
