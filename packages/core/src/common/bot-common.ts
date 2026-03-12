import type { GroupChatMode, GroupAccessState, InboundMessageEvent } from "../pipeline/types.js";

export const resolveMentionedUsers = (event: Pick<InboundMessageEvent, "mentionedWaUserIds" | "quotedWaUserId">): string[] => {
  const mentions = Array.isArray(event.mentionedWaUserIds) ? event.mentionedWaUserIds : [];
  const users = [...mentions];
  if (event.quotedWaUserId) users.unshift(event.quotedWaUserId);
  return Array.from(new Set(users.filter(Boolean)));
};

export const resolveTargetUserFromMentionOrReply = (event: InboundMessageEvent): string | null => {
  if (event.quotedWaUserId) return event.quotedWaUserId;
  if (event.mentionedWaUserIds && event.mentionedWaUserIds.length > 0) return event.mentionedWaUserIds[0];
  return null;
};

export const shouldRespondInGroupChat = (input: {
  chatMode: GroupChatMode;
  isCommand: boolean;
  isToolFollowUp: boolean;
  addressed: boolean;
}): { allow: boolean; reason?: string; commandsOnly?: boolean } => {
  if (input.chatMode === "off") {
    if (input.isCommand || input.isToolFollowUp) return { allow: true, commandsOnly: true };
    return { allow: false, reason: "chat_mode_off" };
  }
  if (!input.isCommand && !input.isToolFollowUp && !input.addressed) {
    return { allow: false, reason: "group_not_addressed" };
  }
  return { allow: true };
};

export const resolveCurrentGroupContext = (access?: GroupAccessState | null) => access ?? null;

export const requireGroupContext = (event: InboundMessageEvent): { ok: boolean; message?: string } => {
  if (event.isGroup) return { ok: true };
  return { ok: false, message: "Este comando só pode ser usado dentro de um grupo." };
};

export const shouldReplyToMessage = (event: InboundMessageEvent): boolean => Boolean(event.waMessageId);

export const buildQuotedReplyOptions = (event: InboundMessageEvent) => ({
  replyToMessageId: event.waMessageId,
  waGroupId: event.waGroupId,
  waUserId: event.waUserId
});

export const resolveAllowedGroupAccess = (access?: GroupAccessState | null): boolean => Boolean(access?.allowed);

export const resolveBotAdminAccess = (access?: GroupAccessState | null): boolean => Boolean(access?.botIsAdmin);
