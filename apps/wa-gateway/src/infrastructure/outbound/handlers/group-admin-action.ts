import { sendTextAndPersist } from "../context.js";
import type { ExecuteOutboundActionsInput } from "../types.js";

export const handleGroupAdminOutboundAction = async (input: {
  runtime: ExecuteOutboundActionsInput;
  action: any;
  responseActionId: string;
}): Promise<boolean> => {
  const { runtime, action, responseActionId } = input;
  if (action.kind !== "group_admin_action") return false;

  let replyText = "";
  let inferredBotAdmin: boolean | undefined;
  let success = false;

  const socket = runtime.getSocket();
  if (!socket) {
    replyText = "Socket não pronto para executar a ação de admin.";
  } else {
    const sock = socket as any;
    const op = action.operation;
    const run = async () => {
      if (op === "set_subject") return sock.groupUpdateSubject(runtime.remoteJid, action.text ?? "");
      if (op === "set_description") return sock.groupUpdateDescription(runtime.remoteJid, action.text ?? "");
      if (op === "set_open") return sock.groupSettingUpdate(runtime.remoteJid, "not_announcement");
      if (op === "set_closed") return sock.groupSettingUpdate(runtime.remoteJid, "announcement");
      if (op === "set_picture_from_quote") {
        const quoted = runtime.contextInfo?.quotedMessage;
        if (!quoted) throw new Error("quoted_image_missing");
        const quotedKey = {
          remoteJid: runtime.remoteJid,
          id: action.quotedWaMessageId ?? runtime.quotedWaMessageId ?? runtime.message.key.id ?? `${Date.now()}`,
          fromMe: false,
          participant: runtime.quotedWaUserId ?? undefined
        };
        const buffer = await runtime.downloadMediaMessage(
          { key: quotedKey, message: quoted } as any,
          "buffer",
          {},
          { logger: runtime.baileysLogger, reuploadRequest: sock.updateMediaMessage }
        );
        return sock.updateProfilePicture(runtime.remoteJid, buffer as any, "image");
      }
      throw new Error("operacao_nao_suportada");
    };

    const opResult = await runtime.attemptGroupAdminAction({ actionName: action.operation, groupJid: runtime.remoteJid, run });
    inferredBotAdmin =
      opResult.kind === "success"
        ? true
        : opResult.kind === "failed_not_admin" || opResult.kind === "failed_not_authorized"
          ? false
          : undefined;
    success = opResult.kind === "success";

    if (success && runtime.context.group) {
      const settings =
        op === "set_subject"
          ? { groupName: action.text ?? runtime.context.group.name }
          : op === "set_description"
            ? { description: action.text ?? null }
            : op === "set_open"
              ? { isOpen: true }
              : op === "set_closed"
                ? { isOpen: false }
                : {};
      if (Object.keys(settings).length > 0) {
        await runtime.groupAccessRepository.updateSettings({
          tenantId: runtime.context.tenant.id,
          waGroupId: runtime.remoteJid,
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

    if (runtime.context.group && inferredBotAdmin !== undefined) {
      await runtime.groupAccessRepository.getGroupAccess({
        tenantId: runtime.context.tenant.id,
        waGroupId: runtime.remoteJid,
        groupName: runtime.context.group?.name ?? runtime.remoteJid,
        botIsAdmin: inferredBotAdmin
      });
    }
  }

  await sendTextAndPersist({
    runtime,
    to: runtime.remoteJid,
    text: replyText,
    actionName: "group_admin_action",
    scope: "group",
    responseActionId
  });
  return true;
};
