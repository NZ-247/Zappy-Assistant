import { buildActionLogContext, logOutbound, sendTextAndPersist } from "../context.js";
import type { ExecuteOutboundActionsInput } from "../types.js";

export const handleModerationOutboundAction = async (input: {
  runtime: ExecuteOutboundActionsInput;
  action: any;
  responseActionId: string;
}): Promise<boolean> => {
  const { runtime, action, responseActionId } = input;
  if (action.kind !== "moderation_action") return false;

  let replyText = "";
  let inferredBotAdmin: boolean | undefined;
  let shouldPersist = true;
  let success = true;
  let resultLabel = "";
  const socket = runtime.getSocket();
  const sock = socket as any;

  if (action.action === "delete_message") {
    if (socket && action.messageKey) {
      try {
        await sock.sendMessage(runtime.event.waGroupId ?? runtime.remoteJid, { delete: action.messageKey } as any);
      } catch (error) {
        runtime.logger.warn?.(
          runtime.withCategory("WARN", { action: "delete_message", waGroupId: runtime.event.waGroupId, error }),
          "failed to delete message"
        );
        success = false;
        resultLabel = "delete_failed";
      }
    }
    shouldPersist = false;
    replyText = "";
  } else if (action.action === "hidetag") {
    const meta = socket ? await socket.groupMetadata(runtime.event.waGroupId ?? runtime.remoteJid) : null;
    const mentions = meta?.participants?.map((p: any) => runtime.normalizeJid(p.id)) ?? [];
    const sent = await runtime.sendWithReplyFallback({
      to: runtime.event.waGroupId ?? runtime.remoteJid,
      content: { text: action.text ?? "", mentions },
      quotedMessage: runtime.message,
      logContext: buildActionLogContext(runtime, "hidetag", "group", responseActionId)
    });
    await runtime.persistOutboundMessage({
      tenantId: runtime.context.tenant.id,
      userId: runtime.context.user.id,
      groupId: runtime.context.group?.id,
      waUserId: runtime.waUserId,
      waGroupId: runtime.event.waGroupId,
      text: action.text ?? "",
      waMessageId: sent.key.id,
      rawJson: sent
    });
    logOutbound(runtime, "hidetag", sent.key.id, action.text ?? "", "group", responseActionId);
    resultLabel = "hidetag";
    return true;
  } else if (action.action === "ban" || action.action === "kick") {
    const target = action.targetWaUserId ? runtime.normalizeJid(action.targetWaUserId) : undefined;
    if (!target) {
      replyText = "Usuário alvo não informado.";
      success = false;
    } else if (!socket) {
      replyText = "Socket não pronto para moderar.";
      success = false;
    } else {
      const opResult = await runtime.attemptGroupAdminAction({
        actionName: action.action,
        groupJid: runtime.event.waGroupId ?? runtime.remoteJid,
        run: () => sock.groupParticipantsUpdate(runtime.event.waGroupId ?? runtime.remoteJid, [target], "remove")
      });
      inferredBotAdmin =
        opResult.kind === "success"
          ? true
          : opResult.kind === "failed_not_admin" || opResult.kind === "failed_not_authorized"
            ? false
            : undefined;
      replyText =
        opResult.kind === "success"
          ? `Usuário ${target} removido.`
          : `Não consegui remover: ${opResult.errorMessage ?? opResult.kind}.`;
      success = opResult.kind === "success";
      resultLabel = opResult.kind;
    }
  } else if (action.action === "mute") {
    const target = action.targetWaUserId ? runtime.normalizeJid(action.targetWaUserId) : undefined;
    if (!target || !action.durationMs) {
      replyText = "Informe usuário e duração para aplicar mute.";
      success = false;
    } else {
      const until = await runtime.muteAdapter.mute({
        tenantId: runtime.context.tenant.id,
        scope: "GROUP",
        scopeId: runtime.event.waGroupId ?? runtime.remoteJid,
        waUserId: target,
        durationMs: action.durationMs,
        now: new Date()
      });
      const fmt = new Intl.DateTimeFormat("pt-BR", {
        timeZone: runtime.timezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(until.until);
      replyText = `Usuário ${target} silenciado até ${fmt}.`;
      resultLabel = "muted";
    }
  } else if (action.action === "unmute") {
    const target = action.targetWaUserId ? runtime.normalizeJid(action.targetWaUserId) : undefined;
    if (!target) {
      replyText = "Informe quem deve ser reativado.";
      success = false;
    } else {
      await runtime.muteAdapter.unmute({
        tenantId: runtime.context.tenant.id,
        scope: "GROUP",
        scopeId: runtime.event.waGroupId ?? runtime.remoteJid,
        waUserId: target
      });
      replyText = `Silêncio removido para ${target}.`;
      resultLabel = "unmuted";
    }
  }

  if (!replyText && !shouldPersist) return true;

  if (runtime.context.group && inferredBotAdmin !== undefined) {
    await runtime.groupAccessRepository.getGroupAccess({
      tenantId: runtime.context.tenant.id,
      waGroupId: runtime.remoteJid,
      groupName: runtime.context.group?.name ?? runtime.remoteJid,
      botIsAdmin: inferredBotAdmin
    });
  }

  await sendTextAndPersist({
    runtime,
    to: runtime.event.waGroupId ?? runtime.remoteJid,
    text: replyText,
    actionName: action.action,
    scope: "group",
    responseActionId,
    persist: shouldPersist
  });
  await runtime.metrics.increment("moderation_actions_total");
  await runtime.auditTrail.record({
    kind: "moderation",
    tenantId: runtime.event.tenantId,
    waUserId: runtime.waUserId,
    waGroupId: runtime.event.waGroupId,
    action: action.action,
    targetWaUserId: action.targetWaUserId,
    success,
    result: resultLabel || replyText || undefined
  });
  return true;
};
