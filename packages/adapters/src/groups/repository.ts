import { AuditAction, ChatMode, FunMode, type Group, type Prisma, type PrismaClient } from "@prisma/client";

export type ModerationConfig = {
  antiLink?: boolean;
  autoDeleteLinks?: boolean;
  antiSpam?: boolean;
  tempMuteSeconds?: number;
};

interface GroupAccessRepositoryDeps {
  prisma: PrismaClient;
  writeAudit: (actor: string, action: AuditAction, entity: string, entityId: string, metadata?: unknown) => Promise<void>;
}

const toChatMode = (mode?: ChatMode | null): "on" | "off" => (mode === ChatMode.OFF ? "off" : "on");

const toFunMode = (mode?: FunMode | null): "on" | "off" | undefined => {
  if (!mode) return undefined;
  return mode === FunMode.ON ? "on" : "off";
};

const normalizeModerationConfig = (value: Prisma.JsonValue | null | undefined): ModerationConfig => {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  return {
    antiLink: Boolean(source.antiLink),
    autoDeleteLinks: Boolean(source.autoDeleteLinks),
    antiSpam: Boolean(source.antiSpam),
    tempMuteSeconds: typeof source.tempMuteSeconds === "number" ? source.tempMuteSeconds : undefined
  };
};

const mapGroupToAccessState = (group: Group) => ({
  waGroupId: group.waGroupId,
  groupName: group.name,
  description: group.description,
  allowed: group.allowed,
  chatMode: toChatMode(group.chatMode),
  isOpen: group.isOpen,
  welcomeEnabled: group.welcomeEnabled,
  welcomeText: group.welcomeText,
  fixedMessageText: group.fixedMessageText,
  rulesText: group.rulesText,
  funMode: toFunMode(group.funMode),
  moderation: normalizeModerationConfig(group.moderationConfig),
  botIsAdmin: group.botIsAdmin,
  botAdminCheckedAt: group.botAdminCheckedAt
});

export const createGroupAccessRepository = (deps: GroupAccessRepositoryDeps) => {
  const { prisma, writeAudit } = deps;

  return {
    getGroupAccess: async (input: { tenantId: string; waGroupId: string; groupName?: string | null; botIsAdmin?: boolean | null }) => {
      let group = await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } });
      const updates: Prisma.GroupUpdateInput = {};

      if (!group) {
        group = await prisma.group.create({
          data: {
            tenantId: input.tenantId,
            waGroupId: input.waGroupId,
            name: input.groupName ?? input.waGroupId,
            chatMode: ChatMode.ON,
            isOpen: true,
            welcomeEnabled: false,
            moderationConfig: {},
            allowed: false,
            botIsAdmin: Boolean(input.botIsAdmin ?? false),
            botAdminCheckedAt: input.botIsAdmin === undefined ? null : new Date()
          }
        });
      } else {
        if (input.groupName && input.groupName !== group.name) updates.name = input.groupName;
        if (typeof input.botIsAdmin === "boolean") {
          updates.botIsAdmin = input.botIsAdmin;
          updates.botAdminCheckedAt = new Date();
        }
      }

      if (Object.keys(updates).length > 0) {
        group = await prisma.group.update({ where: { id: group.id }, data: updates });
      }

      return mapGroupToAccessState(group);
    },

    setAllowed: async (input: { tenantId: string; waGroupId: string; allowed: boolean; actor?: string }) => {
      const group = await prisma.group.upsert({
        where: { waGroupId: input.waGroupId },
        update: { allowed: input.allowed },
        create: {
          tenantId: input.tenantId,
          waGroupId: input.waGroupId,
          name: input.waGroupId,
          allowed: input.allowed,
          chatMode: ChatMode.ON,
          isOpen: true,
          welcomeEnabled: false,
          moderationConfig: {}
        }
      });
      await writeAudit(input.actor ?? "system", AuditAction.UPDATE, "Group", group.id, { allowed: input.allowed });
      return mapGroupToAccessState(group);
    },

    setChatMode: async (input: { tenantId: string; waGroupId: string; mode: "on" | "off"; actor?: string }) => {
      const chatMode = input.mode === "off" ? ChatMode.OFF : ChatMode.ON;
      const group = await prisma.group.upsert({
        where: { waGroupId: input.waGroupId },
        update: { chatMode },
        create: {
          tenantId: input.tenantId,
          waGroupId: input.waGroupId,
          name: input.waGroupId,
          chatMode,
          allowed: false,
          isOpen: true,
          welcomeEnabled: false,
          moderationConfig: {},
          botIsAdmin: false
        }
      });
      await writeAudit(input.actor ?? "system", AuditAction.UPDATE, "Group", group.id, { chatMode: input.mode });
      return mapGroupToAccessState(group);
    },

    updateSettings: async (input: {
      tenantId: string;
      waGroupId: string;
      settings: {
        chatMode?: "on" | "off";
        isOpen?: boolean;
        welcomeEnabled?: boolean;
        welcomeText?: string | null;
        fixedMessageText?: string | null;
        rulesText?: string | null;
        funMode?: "on" | "off" | null;
        moderation?: ModerationConfig;
        groupName?: string | null;
        description?: string | null;
      };
      actor?: string;
    }) => {
      const existing = await prisma.group.findUnique({ where: { waGroupId: input.waGroupId } });
      const updates: Prisma.GroupUpdateInput = {};
      if (input.settings.chatMode) updates.chatMode = input.settings.chatMode === "off" ? ChatMode.OFF : ChatMode.ON;
      if (typeof input.settings.isOpen === "boolean") updates.isOpen = input.settings.isOpen;
      if (typeof input.settings.welcomeEnabled === "boolean") updates.welcomeEnabled = input.settings.welcomeEnabled;
      if ("welcomeText" in input.settings) updates.welcomeText = input.settings.welcomeText ?? null;
      if ("fixedMessageText" in input.settings) updates.fixedMessageText = input.settings.fixedMessageText ?? null;
      if ("rulesText" in input.settings) updates.rulesText = input.settings.rulesText ?? null;
      if ("funMode" in input.settings) {
        updates.funMode =
          input.settings.funMode === undefined
            ? undefined
            : input.settings.funMode === null
              ? null
              : input.settings.funMode === "on"
                ? FunMode.ON
                : FunMode.OFF;
      }
      if (input.settings.moderation) {
        const base = normalizeModerationConfig(existing?.moderationConfig);
        updates.moderationConfig = { ...base, ...(input.settings.moderation ?? {}) } as Prisma.InputJsonValue;
      }
      if ("groupName" in input.settings && input.settings.groupName !== undefined) updates.name = input.settings.groupName ?? undefined;
      if ("description" in input.settings) updates.description = input.settings.description ?? undefined;

      const group = await prisma.group.upsert({
        where: { waGroupId: input.waGroupId },
        update: updates,
        create: {
          tenantId: input.tenantId,
          waGroupId: input.waGroupId,
          name: input.settings.groupName ?? input.waGroupId,
          description: input.settings.description,
          chatMode: input.settings.chatMode === "off" ? ChatMode.OFF : ChatMode.ON,
          isOpen: input.settings.isOpen ?? true,
          welcomeEnabled: input.settings.welcomeEnabled ?? false,
          welcomeText: input.settings.welcomeText ?? null,
          fixedMessageText: input.settings.fixedMessageText ?? null,
          rulesText: input.settings.rulesText ?? null,
          funMode:
            input.settings.funMode === undefined
              ? null
              : input.settings.funMode === null
                ? null
                : input.settings.funMode === "on"
                  ? FunMode.ON
                  : FunMode.OFF,
          moderationConfig: (input.settings.moderation ?? {}) as Prisma.InputJsonValue,
          allowed: false,
          botIsAdmin: false
        }
      });
      await writeAudit(input.actor ?? "system", AuditAction.UPDATE, "Group", group.id, { settings: input.settings });
      return mapGroupToAccessState(group);
    },

    listAllowed: async (tenantId: string) => {
      const groups = await prisma.group.findMany({ where: { tenantId, allowed: true }, orderBy: { name: "asc" } });
      return groups.map((group) => mapGroupToAccessState(group));
    }
  };
};
