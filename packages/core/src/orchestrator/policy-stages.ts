import { formatCommand, hasCommandPrefix, stripCommandPrefix } from "../commands/parser/prefix.js";
import { containsLink } from "../modules/moderation/infrastructure/link-detection.js";
import type { ResponseAction } from "../pipeline/actions.js";
import type { PipelineContext } from "../pipeline/context.js";
import type { LoggerPort } from "../pipeline/ports.js";

const normalizeCommandLower = (text: string, commandPrefix: string): string => stripCommandPrefix(text, commandPrefix).toLowerCase();

export const isAccessControlCommand = (text: string, commandPrefix: string): boolean => {
  if (!hasCommandPrefix(text, commandPrefix)) return false;
  const lower = normalizeCommandLower(text, commandPrefix);
  return (
    lower === "add gp allowed_groups" ||
    lower === "rm gp allowed_groups" ||
    lower === "list gp allowed_groups" ||
    lower.startsWith("add user admins") ||
    lower.startsWith("rm user admins") ||
    lower === "list user admins" ||
    lower.startsWith("set gp chat") ||
    lower.startsWith("chat on") ||
    lower.startsWith("chat off")
  );
};

export const commandRequiresGroupAdmin = (commandName?: string): boolean => {
  if (!commandName) return false;
  const cmd = commandName.toLowerCase();
  if (cmd.startsWith("chat")) return true;
  if (cmd.startsWith("set gp chat")) return true;
  if (cmd.startsWith("set gp open") || cmd.startsWith("set gp close")) return true;
  if (cmd.startsWith("set gp name") || cmd.startsWith("set gp dcr") || cmd.startsWith("set gp img")) return true;
  if (cmd.startsWith("ban") || cmd.startsWith("kick") || cmd.startsWith("hidetag")) return true;
  if (cmd.startsWith("add gp allowed_groups")) return true;
  if (cmd.startsWith("rm gp allowed_groups")) return true;
  return false;
};

export const applyPolicies = (ctx: PipelineContext): { stop?: ResponseAction[] } => {
  if (ctx.conversationState.state === "HANDOFF_ACTIVE") {
    return { stop: [{ kind: "handoff", target: "human", note: "Handoff ativo para este chat." }] };
  }
  const muteActive =
    (ctx.muteInfo && ctx.muteInfo.until.getTime() > ctx.now.getTime()) ||
    (ctx.userMuteInfo && ctx.userMuteInfo.until.getTime() > ctx.now.getTime());
  if (muteActive) ctx.policyMuted = true;
  return {};
};

export const enforceModeration = (
  ctx: PipelineContext,
  deps: {
    isRequesterAdmin: (ctx: PipelineContext) => boolean;
    stylizeReply: (ctx: PipelineContext, text: string, options?: { suggestNext?: string }) => string;
  }
): ResponseAction[] => {
  if (!ctx.event.isGroup) return [];
  if (!ctx.groupModeration) return [];
  const actions: ResponseAction[] = [];
  const isAdmin = deps.isRequesterAdmin(ctx);

  if (ctx.groupModeration.antiLink && !isAdmin && containsLink(ctx.event.normalizedText)) {
    if (ctx.groupModeration.autoDeleteLinks && ctx.event.messageKey) {
      actions.push({
        kind: "moderation_action",
        action: "delete_message",
        waGroupId: ctx.event.waGroupId!,
        messageKey: ctx.event.messageKey
      });
    }
    const warning = deps.stylizeReply(ctx, "Links não são permitidos neste grupo.");
    actions.push({ kind: "reply_text", text: warning });
    if (ctx.groupModeration.tempMuteSeconds && ctx.event.waGroupId) {
      actions.push({
        kind: "moderation_action",
        action: "mute",
        waGroupId: ctx.event.waGroupId,
        targetWaUserId: ctx.event.waUserId,
        durationMs: ctx.groupModeration.tempMuteSeconds * 1000
      });
    }
    return actions;
  }

  return actions;
};

export const enforceGroupPolicies = (
  ctx: PipelineContext,
  deps: {
    commandPrefix: string;
    logger?: LoggerPort;
    isRequesterAdmin: (ctx: PipelineContext) => boolean;
    stylizeReply: (ctx: PipelineContext, text: string, options?: { suggestNext?: string }) => string;
  }
): { stop?: ResponseAction[]; commandsOnly?: boolean } => {
  if (!ctx.event.isGroup) return { commandsOnly: false };

  const isCommand = ctx.classification.kind === "command";
  const isToolFollowUp = ctx.classification.kind === "tool_follow_up";
  const isAccessCommand = isAccessControlCommand(ctx.event.normalizedText, deps.commandPrefix);
  const addressed = ctx.isBotMentioned || ctx.isReplyToBot;
  const directedToBot = isCommand || isToolFollowUp || addressed;
  const isPrivileged = deps.isRequesterAdmin(ctx);
  const routingReason = isCommand
    ? "prefix"
    : ctx.isBotMentioned
      ? "mention"
      : ctx.isReplyToBot
        ? "reply"
        : isToolFollowUp
          ? "follow_up"
          : "none";

  if (ctx.event.isGroup && process.env.NODE_ENV !== "production") {
    const textPreview = ctx.event.normalizedText?.slice(0, 120)?.replace(/"/g, '\\"') ?? "";
    const routeLine = [
      "[GROUP_ROUTE]",
      `directedToBot=${directedToBot}`,
      `reason=${routingReason}`,
      `mention=${ctx.isBotMentioned}`,
      `reply=${ctx.isReplyToBot}`,
      `text=\"${textPreview}\"`
    ].join(" ");
    deps.logger?.debug?.(routeLine);
  }

  if (!directedToBot) {
    return { stop: [{ kind: "noop", reason: "group_not_addressed" }] };
  }

  if (!ctx.groupAllowed) {
    if (isAccessCommand && isPrivileged) return { commandsOnly: true };
    const text = `Este grupo não está autorizado a usar o bot. Um admin deve enviar ${formatCommand(deps.commandPrefix, "add gp allowed_groups")} para liberar. Comandos privados continuam disponíveis.`;
    return { stop: [{ kind: "reply_text", text: deps.stylizeReply(ctx, text) }] };
  }

  if (ctx.groupChatMode === "off") {
    if (isCommand || isToolFollowUp || isAccessCommand) return { commandsOnly: true };
    return { stop: [{ kind: "noop", reason: "chat_mode_off" }] };
  }

  const requiresGroupAdmin = isCommand && commandRequiresGroupAdmin(ctx.classification.commandName);
  if (requiresGroupAdmin && (ctx.botAdminCheckFailed || !ctx.botIsGroupAdmin) && process.env.NODE_ENV !== "production") {
    deps.logger?.debug?.(
      {
        category: "BOT_ADMIN_GUARD",
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        command: ctx.classification.commandName,
        guard: "requires_group_admin",
        decision: "proceed_operation_first",
        botIsAdmin: ctx.botIsGroupAdmin,
        sourceUsed: ctx.botAdminSourceUsed,
        statusSource: ctx.botAdminStatusSource,
        eventBotIsAdmin: ctx.event.botIsGroupAdmin,
        eventBotAdminSource: ctx.event.botAdminStatusSource,
        groupBotIsAdmin: ctx.groupAccess?.botIsAdmin,
        groupBotCheckedAt: ctx.groupAccess?.botAdminCheckedAt?.toISOString?.(),
        botAdminCheckedAt: ctx.botAdminCheckedAt?.toISOString?.(),
        resolutionPath: ctx.botAdminResolutionPath?.map((item) => ({ source: item.source, value: item.value })),
        checkFailed: ctx.botAdminCheckFailed,
        checkError: ctx.botAdminCheckError
      },
      "bot admin pre-check bypassed (operation-first)"
    );
  }

  if (!isCommand && !isToolFollowUp && !addressed) {
    return { stop: [{ kind: "noop", reason: "group_not_addressed" }] };
  }

  return { commandsOnly: false };
};
