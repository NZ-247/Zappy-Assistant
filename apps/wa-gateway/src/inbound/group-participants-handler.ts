import type { PrismaClient } from "@prisma/client";

type GroupParticipantsUpdate = {
  id?: string;
  participants?: string[];
  action?: string;
};

interface GroupParticipantsHandlerDeps {
  getSocket: () => any | null;
  prisma: PrismaClient;
  normalizeJid: (jid: string) => string;
  stripUser: (jid?: string | null) => string | null;
  refreshBotAdminState: (input: {
    waGroupId: string;
    tenantId?: string;
    groupName?: string | null;
    force?: boolean;
    origin?: string;
    operationFirst?: boolean;
  }) => Promise<{ isAdmin?: boolean }>;
  ensureTenantContext: (input: {
    waGroupId?: string;
    waUserId: string;
    defaultTenantName: string;
    onlyGroupId?: string;
    remoteJid?: string;
    userName?: string | null;
  }) => Promise<{ tenant: { id: string }; group?: { id: string; name?: string | null } | null }>;
  groupAccessRepository: {
    getGroupAccess: (input: { tenantId: string; waGroupId: string; groupName?: string; botIsAdmin?: boolean }) => Promise<{
      welcomeEnabled?: boolean;
      welcomeText?: string | null;
      rulesText?: string | null;
      fixedMessageText?: string | null;
      groupName?: string | null;
    } | null>;
  };
  sendWithReplyFallback: (input: {
    to: string;
    content: any;
    quotedMessage?: any;
    logContext: Record<string, unknown>;
  }) => Promise<any>;
  persistOutboundMessage: (input: {
    tenantId: string;
    userId?: string;
    groupId?: string;
    waUserId: string;
    waGroupId?: string;
    text: string;
    waMessageId?: string;
    rawJson?: unknown;
  }) => Promise<unknown>;
  logger: {
    info: (payload: unknown, message?: string) => void;
    warn: (payload: unknown, message?: string) => void;
  };
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  env: {
    DEFAULT_TENANT_NAME: string;
    ONLY_GROUP_ID?: string;
  };
}

export const createGroupParticipantsUpdateHandler = (deps: GroupParticipantsHandlerDeps) => {
  return async (update: GroupParticipantsUpdate) => {
    try {
      const socket = deps.getSocket();
      const botId = socket?.user?.id ? deps.normalizeJid(socket.user.id) : undefined;
      if (!update?.id) return;
      const participants = (update.participants ?? []).map((participant) => deps.normalizeJid(participant));
      const involvesBot = botId ? participants.includes(botId) : false;

      const groupRecord = await deps.prisma.group.findUnique({ where: { waGroupId: update.id } });
      if (involvesBot) {
        const status = await deps.refreshBotAdminState({
          waGroupId: update.id,
          tenantId: groupRecord?.tenantId,
          groupName: groupRecord?.name,
          force: true,
          origin: "participants.update",
          operationFirst: true
        });
        deps.logger.info(
          deps.withCategory("SYSTEM", { waGroupId: update.id, botIsAdmin: status.isAdmin, source: "participants.update" }),
          "refreshed bot admin status"
        );
      }

      if (update.action === "add") {
        const newMembers = participants.filter((participant) => participant !== botId);
        if (newMembers.length === 0) return;

        let tenantId = groupRecord?.tenantId;
        let groupName = groupRecord?.name ?? update.id;
        if (!tenantId) {
          const context = await deps.ensureTenantContext({
            waGroupId: update.id,
            waUserId: newMembers[0],
            defaultTenantName: deps.env.DEFAULT_TENANT_NAME,
            onlyGroupId: deps.env.ONLY_GROUP_ID,
            remoteJid: update.id,
            userName: null
          });
          tenantId = context.tenant.id;
          groupName = context.group?.name ?? update.id;
        }

        const access = tenantId
          ? await deps.groupAccessRepository.getGroupAccess({
              tenantId,
              waGroupId: update.id,
              groupName,
              botIsAdmin: groupRecord?.botIsAdmin ?? undefined
            })
          : null;

        if (access?.welcomeEnabled) {
          const names = newMembers.map((participant) => deps.stripUser(participant) ?? participant).join(", ");
          const base = access.welcomeText ?? "Bem-vindo(a), {{user}}!";
          let text = base.replace(/{{user}}/g, names).replace(/{{group}}/g, access.groupName ?? update.id);
          if (access.rulesText) text += `\n\nRegras:\n${access.rulesText}`;
          if (access.fixedMessageText) text += `\n\n${access.fixedMessageText}`;

          const sent = await deps.sendWithReplyFallback({
            to: update.id,
            content: { text },
            quotedMessage: undefined,
            logContext: { tenantId: tenantId ?? "unknown", scope: "group", action: "welcome", waUserId: newMembers[0], waGroupId: update.id }
          });

          if (tenantId) {
            await deps.persistOutboundMessage({
              tenantId,
              userId: undefined,
              groupId: groupRecord?.id,
              waUserId: newMembers[0],
              waGroupId: update.id,
              text,
              waMessageId: sent?.key?.id,
              rawJson: sent
            });
          }
        }
      }
    } catch (error) {
      deps.logger.warn(deps.withCategory("WARN", { waGroupId: update?.id, error }), "failed to handle participant update");
    }
  };
};
