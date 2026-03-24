interface SendWithReplyFallbackInput {
  to: string;
  content: any;
  quotedMessage?: any;
  logContext: Record<string, unknown>;
}

interface ExecuteOutboundActionsInput {
  actions: any[];
  isGroup: boolean;
  remoteJid: string;
  waUserId: string;
  event: any;
  message: any;
  context: any;
  contextInfo?: any;
  quotedWaMessageId?: string;
  quotedWaUserId?: string;
  canonical?: {
    phoneNumber?: string | null;
  } | null;
  normalizedPhone?: string;
  relationshipProfile?: string | null;
  permissionRole?: string | null;
  timezone: string;
  sendWithReplyFallback: (input: SendWithReplyFallbackInput) => Promise<any>;
  persistOutboundMessage: (input: any) => Promise<unknown>;
  queueAdapter: {
    enqueueReminder: (reminderId: string, runAt: Date) => Promise<unknown>;
    enqueueTimer: (timerId: string, runAt: Date) => Promise<unknown>;
  };
  groupAccessRepository: {
    getGroupAccess: (input: any) => Promise<any>;
    updateSettings: (input: any) => Promise<any>;
  };
  muteAdapter: {
    mute: (input: any) => Promise<{ until: Date }>;
    unmute: (input: any) => Promise<void>;
  };
  attemptGroupAdminAction: (input: {
    actionName: string;
    groupJid: string;
    run: () => Promise<unknown>;
  }) => Promise<{ kind: string; errorMessage?: string }>;
  getSocket: () => any | null;
  downloadMediaMessage: (message: any, type: "buffer" | "stream", options: any, ctx?: any) => Promise<unknown>;
  baileysLogger: any;
  normalizeJid: (value: string) => string;
  logger: {
    info?: (payload: unknown, message?: string) => void;
    warn?: (payload: unknown, message?: string) => void;
  };
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  metrics: { increment: (key: any, by?: number) => Promise<void> };
  auditTrail: { record: (event: any) => Promise<void> };
}

const logOutbound = (
  input: ExecuteOutboundActionsInput,
  action: string,
  waMessageId: string,
  text: string,
  scope: "group" | "direct",
  responseActionId: string
) => {
  input.logger.info?.(
    input.withCategory("WA-OUT", {
      tenantId: input.event.tenantId,
      scope,
      waUserId: input.waUserId,
      phoneNumber: input.canonical?.phoneNumber,
      normalizedPhone: input.normalizedPhone,
      permissionRole: input.permissionRole,
      relationshipProfile: input.relationshipProfile,
      waGroupId: input.event.waGroupId,
      waMessageId,
      inboundWaMessageId: input.event.waMessageId,
      executionId: input.event.executionId,
      responseActionId,
      action,
      textPreview: text.slice(0, 80)
    }),
    "outbound message"
  );
};

const buildResponseActionId = (input: ExecuteOutboundActionsInput, action: any, actionIndex: number): string => {
  const baseExecutionId =
    (typeof input.event.executionId === "string" && input.event.executionId.trim().length > 0
      ? input.event.executionId
      : input.event.waMessageId) ?? "noexec";
  return `${baseExecutionId}:a${actionIndex + 1}:${action.kind ?? "unknown"}`;
};

const buildActionLogContext = (
  input: ExecuteOutboundActionsInput,
  actionName: string,
  scope: "group" | "direct",
  responseActionId: string
): Record<string, unknown> => ({
  tenantId: input.event.tenantId,
  scope,
  action: actionName,
  waUserId: input.waUserId,
  waGroupId: input.event.waGroupId,
  inboundWaMessageId: input.event.waMessageId,
  executionId: input.event.executionId,
  responseActionId
});

export const executeOutboundActions = async (input: ExecuteOutboundActionsInput): Promise<void> => {
  for (let actionIndex = 0; actionIndex < input.actions.length; actionIndex += 1) {
    const action = input.actions[actionIndex];
    const responseActionId = buildResponseActionId(input, action, actionIndex);

    if (action.kind === "enqueue_job") {
      const runAt = action.payload.runAt ? new Date(action.payload.runAt) : new Date();
      if (action.jobType === "reminder") {
        await input.queueAdapter.enqueueReminder(String(action.payload.id), runAt);
      } else if (action.jobType === "timer") {
        await input.queueAdapter.enqueueTimer(String(action.payload.id), runAt);
      } else {
        input.logger.warn?.({ jobType: action.jobType, payload: action.payload }, "unknown enqueue_job action");
      }
      continue;
    }

    if (action.kind === "noop") {
      continue;
    }

    if (action.kind === "handoff") {
      const note = action.note ?? "Handoff solicitado.";
      const to = input.isGroup ? input.remoteJid : input.waUserId;
      const sent = await input.sendWithReplyFallback({
        to,
        content: { text: note },
        quotedMessage: input.message,
        logContext: buildActionLogContext(input, "handoff", input.isGroup ? "group" : "direct", responseActionId)
      });
      await input.persistOutboundMessage({
        tenantId: input.context.tenant.id,
        userId: input.context.user.id,
        groupId: input.context.group?.id,
        waUserId: input.waUserId,
        waGroupId: input.event.waGroupId,
        text: note,
        waMessageId: sent.key.id,
        rawJson: sent
      });
      logOutbound(input, "handoff", sent.key.id, note, input.isGroup ? "group" : "direct", responseActionId);
      continue;
    }

    if (action.kind === "ai_tool_suggestion") {
      const to = input.isGroup ? input.remoteJid : input.waUserId;
      const textToSend =
        action.text ??
        `Posso executar: ${action.tool.action}. Diga 'ok' para confirmar ou detalhe o que precisa.`;
      const sent = await input.sendWithReplyFallback({
        to,
        content: { text: textToSend },
        quotedMessage: input.message,
        logContext: buildActionLogContext(input, "ai_tool_suggestion", input.isGroup ? "group" : "direct", responseActionId)
      });
      await input.persistOutboundMessage({
        tenantId: input.context.tenant.id,
        userId: input.context.user.id,
        groupId: input.context.group?.id,
        waUserId: input.waUserId,
        waGroupId: input.event.waGroupId,
        text: textToSend,
        waMessageId: sent.key.id,
        rawJson: sent
      });
      logOutbound(input, "ai_tool_suggestion", sent.key.id, textToSend, input.isGroup ? "group" : "direct", responseActionId);
      continue;
    }

    if (action.kind === "group_admin_action") {
      const to = input.remoteJid;
      let replyText = "";
      let inferredBotAdmin: boolean | undefined;
      let success = false;

      const socket = input.getSocket();
      if (!socket) {
        replyText = "Socket não pronto para executar a ação de admin.";
      } else {
        const sock = socket as any;
        const op = action.operation;
        const run = async () => {
          if (op === "set_subject") return sock.groupUpdateSubject(input.remoteJid, action.text ?? "");
          if (op === "set_description") return sock.groupUpdateDescription(input.remoteJid, action.text ?? "");
          if (op === "set_open") return sock.groupSettingUpdate(input.remoteJid, "not_announcement");
          if (op === "set_closed") return sock.groupSettingUpdate(input.remoteJid, "announcement");
          if (op === "set_picture_from_quote") {
            const quoted = input.contextInfo?.quotedMessage;
            if (!quoted) throw new Error("quoted_image_missing");
            const quotedKey = {
              remoteJid: input.remoteJid,
              id: action.quotedWaMessageId ?? input.quotedWaMessageId ?? input.message.key.id ?? `${Date.now()}`,
              fromMe: false,
              participant: input.quotedWaUserId ?? undefined
            };
            const buffer = await input.downloadMediaMessage(
              { key: quotedKey, message: quoted } as any,
              "buffer",
              {},
              { logger: input.baileysLogger, reuploadRequest: sock.updateMediaMessage }
            );
            return sock.updateProfilePicture(input.remoteJid, buffer as any, "image");
          }
          throw new Error("operacao_nao_suportada");
        };

        const opResult = await input.attemptGroupAdminAction({ actionName: action.operation, groupJid: input.remoteJid, run });
        inferredBotAdmin =
          opResult.kind === "success"
            ? true
            : opResult.kind === "failed_not_admin" || opResult.kind === "failed_not_authorized"
              ? false
              : undefined;
        success = opResult.kind === "success";

        if (success && input.context.group) {
          const settings =
            op === "set_subject"
              ? { groupName: action.text ?? input.context.group.name }
              : op === "set_description"
                ? { description: action.text ?? null }
                : op === "set_open"
                  ? { isOpen: true }
                  : op === "set_closed"
                    ? { isOpen: false }
                    : {};
          if (Object.keys(settings).length > 0) {
            await input.groupAccessRepository.updateSettings({
              tenantId: input.context.tenant.id,
              waGroupId: input.remoteJid,
              actor: action.actorWaUserId,
              settings
            });
          }
        }

        switch (op) {
          case "set_subject":
            replyText = success ? `Nome do grupo atualizado para \"${action.text}\".` : `Não consegui alterar o nome: ${opResult.errorMessage ?? opResult.kind}.`;
            break;
          case "set_description":
            replyText = success ? "Descrição do grupo atualizada." : `Não consegui alterar a descrição: ${opResult.errorMessage ?? opResult.kind}.`;
            break;
          case "set_open":
            replyText = success ? "Grupo reaberto. Todos podem enviar mensagens." : `Não consegui reabrir: ${opResult.errorMessage ?? opResult.kind}.`;
            break;
          case "set_closed":
            replyText = success ? "Grupo fechado. Apenas admins podem enviar mensagens." : `Não consegui fechar: ${opResult.errorMessage ?? opResult.kind}.`;
            break;
          case "set_picture_from_quote":
            if (opResult.kind === "success") replyText = "Foto do grupo atualizada.";
            else if (opResult.errorMessage === "quoted_image_missing") replyText = "Responda a uma imagem para usar como foto.";
            else replyText = `Não consegui atualizar a foto: ${opResult.errorMessage ?? opResult.kind}.`;
            break;
          default:
            replyText = success ? "Ação concluída." : "Ação não concluída.";
        }

        if (input.context.group && inferredBotAdmin !== undefined) {
          await input.groupAccessRepository.getGroupAccess({
            tenantId: input.context.tenant.id,
            waGroupId: input.remoteJid,
            groupName: input.context.group?.name ?? input.remoteJid,
            botIsAdmin: inferredBotAdmin
          });
        }
      }

      const sent = await input.sendWithReplyFallback({
        to,
        content: { text: replyText },
        quotedMessage: input.message,
        logContext: buildActionLogContext(input, "group_admin_action", "group", responseActionId)
      });
      await input.persistOutboundMessage({
        tenantId: input.context.tenant.id,
        userId: input.context.user.id,
        groupId: input.context.group?.id,
        waUserId: input.waUserId,
        waGroupId: input.event.waGroupId,
        text: replyText,
        waMessageId: sent.key.id,
        rawJson: sent
      });
      logOutbound(input, "group_admin_action", sent.key.id, replyText, "group", responseActionId);
      continue;
    }

    if (action.kind === "moderation_action") {
      let replyText = "";
      let inferredBotAdmin: boolean | undefined;
      let shouldPersist = true;
      let success = true;
      let resultLabel = "";
      const socket = input.getSocket();
      const sock = socket as any;

      if (action.action === "delete_message") {
        if (socket && action.messageKey) {
          try {
            await sock.sendMessage(input.event.waGroupId ?? input.remoteJid, { delete: action.messageKey } as any);
          } catch (error) {
            input.logger.warn?.(
              input.withCategory("WARN", { action: "delete_message", waGroupId: input.event.waGroupId, error }),
              "failed to delete message"
            );
            success = false;
            resultLabel = "delete_failed";
          }
        }
        shouldPersist = false;
        replyText = "";
      } else if (action.action === "hidetag") {
        const meta = socket ? await socket.groupMetadata(input.event.waGroupId ?? input.remoteJid) : null;
        const mentions = meta?.participants?.map((p: any) => input.normalizeJid(p.id)) ?? [];
        const sent = await input.sendWithReplyFallback({
          to: input.event.waGroupId ?? input.remoteJid,
          content: { text: action.text ?? "", mentions },
          quotedMessage: input.message,
          logContext: buildActionLogContext(input, "hidetag", "group", responseActionId)
        });
        await input.persistOutboundMessage({
          tenantId: input.context.tenant.id,
          userId: input.context.user.id,
          groupId: input.context.group?.id,
          waUserId: input.waUserId,
          waGroupId: input.event.waGroupId,
          text: action.text ?? "",
          waMessageId: sent.key.id,
          rawJson: sent
        });
        logOutbound(input, "hidetag", sent.key.id, action.text ?? "", "group", responseActionId);
        resultLabel = "hidetag";
        continue;
      } else if (action.action === "ban" || action.action === "kick") {
        const target = action.targetWaUserId ? input.normalizeJid(action.targetWaUserId) : undefined;
        if (!target) {
          replyText = "Usuário alvo não informado.";
          success = false;
        } else if (!socket) {
          replyText = "Socket não pronto para moderar.";
          success = false;
        } else {
          const opResult = await input.attemptGroupAdminAction({
            actionName: action.action,
            groupJid: input.event.waGroupId ?? input.remoteJid,
            run: () => sock.groupParticipantsUpdate(input.event.waGroupId ?? input.remoteJid, [target], "remove")
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
        const target = action.targetWaUserId ? input.normalizeJid(action.targetWaUserId) : undefined;
        if (!target || !action.durationMs) {
          replyText = "Informe usuário e duração para aplicar mute.";
          success = false;
        } else {
          const until = await input.muteAdapter.mute({
            tenantId: input.context.tenant.id,
            scope: "GROUP",
            scopeId: input.event.waGroupId ?? input.remoteJid,
            waUserId: target,
            durationMs: action.durationMs,
            now: new Date()
          });
          const fmt = new Intl.DateTimeFormat("pt-BR", {
            timeZone: input.timezone,
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
        const target = action.targetWaUserId ? input.normalizeJid(action.targetWaUserId) : undefined;
        if (!target) {
          replyText = "Informe quem deve ser reativado.";
          success = false;
        } else {
          await input.muteAdapter.unmute({
            tenantId: input.context.tenant.id,
            scope: "GROUP",
            scopeId: input.event.waGroupId ?? input.remoteJid,
            waUserId: target
          });
          replyText = `Silêncio removido para ${target}.`;
          resultLabel = "unmuted";
        }
      }

      if (!replyText && !shouldPersist) continue;

      if (input.context.group && inferredBotAdmin !== undefined) {
        await input.groupAccessRepository.getGroupAccess({
          tenantId: input.context.tenant.id,
          waGroupId: input.remoteJid,
          groupName: input.context.group?.name ?? input.remoteJid,
          botIsAdmin: inferredBotAdmin
        });
      }

      const sent = await input.sendWithReplyFallback({
        to: input.event.waGroupId ?? input.remoteJid,
        content: { text: replyText },
        quotedMessage: input.message,
        logContext: buildActionLogContext(input, action.action, "group", responseActionId)
      });
      if (shouldPersist) {
        await input.persistOutboundMessage({
          tenantId: input.context.tenant.id,
          userId: input.context.user.id,
          groupId: input.context.group?.id,
          waUserId: input.waUserId,
          waGroupId: input.event.waGroupId,
          text: replyText,
          waMessageId: sent.key.id,
          rawJson: sent
        });
      }
      logOutbound(input, action.action, sent.key.id, replyText, "group", responseActionId);
      await input.metrics.increment("moderation_actions_total");
      await input.auditTrail.record({
        kind: "moderation",
        tenantId: input.event.tenantId,
        waUserId: input.waUserId,
        waGroupId: input.event.waGroupId,
        action: action.action,
        targetWaUserId: action.targetWaUserId,
        success,
        result: resultLabel || replyText || undefined
      });
      continue;
    }

    if (action.kind !== "reply_text" && action.kind !== "reply_list") continue;

    const to = input.isGroup ? input.remoteJid : input.waUserId;
    const textToSend =
      action.kind === "reply_text"
        ? action.text
        : [action.header, ...action.items.map((item: any) => `• ${item.title}${item.description ? ` — ${item.description}` : ""}`), action.footer]
            .filter(Boolean)
            .join("\n");
    const sent = await input.sendWithReplyFallback({
      to,
      content: { text: textToSend },
      quotedMessage: input.message,
      logContext: buildActionLogContext(input, action.kind, input.isGroup ? "group" : "direct", responseActionId)
    });
    await input.persistOutboundMessage({
      tenantId: input.context.tenant.id,
      userId: input.context.user.id,
      groupId: input.context.group?.id,
      waUserId: input.waUserId,
      waGroupId: input.event.waGroupId,
      text: textToSend,
      waMessageId: sent.key.id,
      rawJson: sent
    });
    logOutbound(input, action.kind, sent.key.id, textToSend, input.isGroup ? "group" : "direct", responseActionId);
  }
};
