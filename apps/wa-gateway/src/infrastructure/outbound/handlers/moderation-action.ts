import { buildActionLogContext, logOutbound, sendTextAndPersist } from "../context.js";
import type { ExecuteOutboundActionsInput } from "../types.js";
import { prepareWhatsAppAudioForSend } from "./wa-audio-send-pipeline.js";

type HidetagContentKind =
  | "text"
  | "reply_text"
  | "reply_image"
  | "reply_ptt"
  | "reply_audio"
  | "reply_sticker"
  | "reply_video"
  | "reply_document";

const normalizeMessageType = (value?: string): string => (value ?? "").trim().toLowerCase();

const unwrapQuotedMessage = (message: any): any => {
  let current = message;
  let depth = 0;

  while (current && typeof current === "object" && depth < 8) {
    const next =
      current?.ephemeralMessage?.message ??
      current?.viewOnceMessage?.message ??
      current?.viewOnceMessageV2?.message ??
      current?.viewOnceMessageV2Extension?.message ??
      current?.documentWithCaptionMessage?.message ??
      current?.editedMessage?.message;
    if (!next || next === current) break;
    current = next;
    depth += 1;
  }

  return current;
};

const resolveHidetagContentKind = (action: any): HidetagContentKind => {
  const fromPayload = normalizeMessageType(action?.hidetagContent?.kind);
  if (fromPayload === "reply_text") return "reply_text";
  if (fromPayload === "reply_image") return "reply_image";
  if (fromPayload === "reply_ptt") return "reply_ptt";
  if (fromPayload === "reply_audio") return "reply_audio";
  if (fromPayload === "reply_sticker") return "reply_sticker";
  if (fromPayload === "reply_video") return "reply_video";
  if (fromPayload === "reply_document") return "reply_document";
  return "text";
};

const isUnsafeDocumentMime = (value?: string): boolean => {
  const mimeType = (value ?? "").trim().toLowerCase();
  if (!mimeType) return true;
  return /(?:x-msdownload|x-msdos-program|x-dosexec|x-sh|x-bat|x-executable|java-archive|x-msi)/i.test(mimeType);
};

const ensureDocumentSafe = (value?: string): boolean => {
  const mimeType = (value ?? "").trim().toLowerCase();
  if (!mimeType || isUnsafeDocumentMime(mimeType)) return false;
  if (mimeType.startsWith("image/")) return true;
  if (mimeType.startsWith("audio/")) return true;
  if (mimeType.startsWith("video/")) return true;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType.startsWith("application/")) return true;
  return false;
};

const buildQuotedPayload = (runtime: ExecuteOutboundActionsInput, quotedMessage: any) => ({
  key: {
    remoteJid: runtime.remoteJid,
    id: runtime.quotedWaMessageId ?? runtime.event.quotedWaMessageId ?? runtime.message?.key?.id ?? `${Date.now()}`,
    fromMe: false,
    participant: runtime.quotedWaUserId ?? runtime.event.quotedWaUserId ?? undefined
  },
  message: quotedMessage
});

const downloadQuotedMedia = async (runtime: ExecuteOutboundActionsInput, quotedMessage: any): Promise<Buffer> => {
  const socket = runtime.getSocket();
  const sock = socket as any;
  const reuploadRequest = typeof sock?.updateMediaMessage === "function" ? sock.updateMediaMessage.bind(sock) : undefined;
  const downloaded = await runtime.downloadMediaMessage(buildQuotedPayload(runtime, quotedMessage), "buffer", {}, {
    logger: runtime.baileysLogger,
    reuploadRequest
  });
  const mediaBuffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as Uint8Array);
  if (!mediaBuffer.length) {
    throw new Error("quoted_media_empty");
  }
  return mediaBuffer;
};

const buildHiddenMentionsContext = (mentions: string[]): { mentionedJid: string[] } | undefined =>
  mentions.length > 0 ? { mentionedJid: mentions } : undefined;

const extractQuotedCaption = (quotedMessage: any): string | undefined =>
  quotedMessage?.imageMessage?.caption ?? quotedMessage?.videoMessage?.caption ?? quotedMessage?.documentMessage?.caption ?? undefined;

const recordModerationOutcome = async (input: {
  runtime: ExecuteOutboundActionsInput;
  action: any;
  success: boolean;
  result: string;
}): Promise<void> => {
  await input.runtime.metrics.increment("moderation_actions_total");
  await input.runtime.auditTrail.record({
    kind: "moderation",
    tenantId: input.runtime.event.tenantId,
    waUserId: input.runtime.waUserId,
    waGroupId: input.runtime.event.waGroupId,
    action: input.action.action,
    targetWaUserId: input.action.targetWaUserId,
    success: input.success,
    result: input.result || undefined
  });
};

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
    try {
      const meta = socket ? await socket.groupMetadata(runtime.event.waGroupId ?? runtime.remoteJid) : null;
      const mentions = meta?.participants?.map((participant: any) => runtime.normalizeJid(participant.id)) ?? [];
      const hiddenContext = buildHiddenMentionsContext(mentions);
      const hidetagKind = resolveHidetagContentKind(action);
      const actionText = (action.text ?? action.hidetagContent?.text ?? "").trim();

      let content: any;
      let persistedText = actionText;

      if (hidetagKind === "text" || hidetagKind === "reply_text") {
        content = {
          text: actionText,
          mentions
        };
      } else {
        const quotedMessage = unwrapQuotedMessage(runtime.contextInfo?.quotedMessage);
        const quotedType = normalizeMessageType(quotedMessage ? Object.keys(quotedMessage)[0] : "");
        const quotedCaption = extractQuotedCaption(quotedMessage);

        if (!quotedMessage) {
          replyText = "Não encontrei a mídia respondida para o hidetag.";
          success = false;
          resultLabel = "hidetag_media_missing";
        } else if (hidetagKind === "reply_image" && quotedType !== "imagemessage") {
          replyText = "Responda uma imagem válida para usar hidetag com mídia.";
          success = false;
          resultLabel = "hidetag_image_missing";
        } else if ((hidetagKind === "reply_audio" || hidetagKind === "reply_ptt") && quotedType !== "audiomessage") {
          replyText = "Responda um áudio válido para usar hidetag com mídia.";
          success = false;
          resultLabel = "hidetag_audio_missing";
        } else if (hidetagKind === "reply_sticker" && quotedType !== "stickermessage") {
          replyText = "Responda uma figurinha válida para usar hidetag com mídia.";
          success = false;
          resultLabel = "hidetag_sticker_missing";
        } else if (hidetagKind === "reply_video" && quotedType !== "videomessage") {
          replyText = "Responda um vídeo válido para usar hidetag com mídia.";
          success = false;
          resultLabel = "hidetag_video_missing";
        } else if (hidetagKind === "reply_document" && quotedType !== "documentmessage") {
          replyText = "Responda um documento válido para usar hidetag com mídia.";
          success = false;
          resultLabel = "hidetag_document_missing";
        } else {
          const mediaBuffer = await downloadQuotedMedia(runtime, quotedMessage);
          if (hidetagKind === "reply_image") {
            content = {
              image: mediaBuffer,
              caption: actionText || quotedCaption,
              mentions,
              contextInfo: hiddenContext
            };
            persistedText = actionText || quotedCaption || "[hidetag imagem]";
          } else if (hidetagKind === "reply_audio" || hidetagKind === "reply_ptt") {
            const mimeType = quotedMessage?.audioMessage?.mimetype || "audio/ogg; codecs=opus";
            const shouldSendAsPtt = hidetagKind === "reply_ptt";
            runtime.logger.info?.(
              runtime.withCategory("WA-OUT", {
                action: "hidetag",
                status: "hidetag_audio_kind_detected",
                responseActionId,
                waGroupId: runtime.event.waGroupId,
                quotedAudioPtt: quotedMessage?.audioMessage?.ptt === true,
                requestedHidetagKind: hidetagKind,
                requestedPtt: shouldSendAsPtt
              }),
              "hidetag audio kind detected"
            );

            if (shouldSendAsPtt) {
              runtime.logger.info?.(
                runtime.withCategory("WA-OUT", {
                  action: "hidetag",
                  status: "hidetag_ptt_transcode_started",
                  responseActionId,
                  waGroupId: runtime.event.waGroupId,
                  requestedMimeType: mimeType
                }),
                "hidetag ptt normalization started"
              );
            }

            const preparedAudio = await prepareWhatsAppAudioForSend({
              audioBuffer: mediaBuffer,
              mimeType,
              requestPtt: shouldSendAsPtt
            });

            if (shouldSendAsPtt && preparedAudio.ptt) {
              runtime.logger.info?.(
                runtime.withCategory("WA-OUT", {
                  action: "hidetag",
                  status: "hidetag_ptt_transcode_success",
                  responseActionId,
                  waGroupId: runtime.event.waGroupId,
                  requestedMimeType: mimeType,
                  finalMimeType: preparedAudio.mimeType,
                  transcodedToPtt: preparedAudio.transcodedToPtt,
                  inputContainer: preparedAudio.inputProbe.container,
                  inputCodecGuess: preparedAudio.inputProbe.codecGuess,
                  outputContainer: preparedAudio.outputProbe.container,
                  outputCodecGuess: preparedAudio.outputProbe.codecGuess
                }),
                "hidetag ptt normalization succeeded"
              );
            } else if (shouldSendAsPtt && !preparedAudio.ptt) {
              runtime.logger.warn?.(
                runtime.withCategory("WA-OUT", {
                  action: "hidetag",
                  status: "hidetag_ptt_transcode_fallback",
                  responseActionId,
                  waGroupId: runtime.event.waGroupId,
                  requestedMimeType: mimeType,
                  finalMimeType: preparedAudio.mimeType,
                  reason: preparedAudio.transcodeReason ?? "ptt_transcode_failed",
                  inputContainer: preparedAudio.inputProbe.container,
                  inputCodecGuess: preparedAudio.inputProbe.codecGuess
                }),
                "hidetag ptt normalization failed; fallback to regular audio"
              );
            }

            content = {
              audio: preparedAudio.audioBuffer,
              mimetype: preparedAudio.mimeType,
              ptt: preparedAudio.ptt,
              contextInfo: hiddenContext
            };
            persistedText = actionText || (preparedAudio.ptt ? "[hidetag voz]" : "[hidetag audio]");
          } else if (hidetagKind === "reply_sticker") {
            content = {
              sticker: mediaBuffer,
              contextInfo: hiddenContext
            };
            persistedText = actionText || "[hidetag figurinha]";
          } else if (hidetagKind === "reply_video") {
            const mimeType = quotedMessage?.videoMessage?.mimetype || "video/mp4";
            content = {
              video: mediaBuffer,
              mimetype: mimeType,
              caption: actionText || quotedCaption,
              mentions,
              contextInfo: hiddenContext
            };
            persistedText = actionText || quotedCaption || "[hidetag video]";
          } else {
            const documentMimeType = quotedMessage?.documentMessage?.mimetype;
            if (!ensureDocumentSafe(documentMimeType)) {
              replyText = "Esse documento não é seguro/compatível para reenviar via hidetag.";
              success = false;
              resultLabel = "hidetag_document_unsafe";
            } else {
              content = {
                document: mediaBuffer,
                mimetype: documentMimeType || "application/octet-stream",
                fileName: quotedMessage?.documentMessage?.fileName || "arquivo",
                caption: actionText || quotedCaption,
                mentions,
                contextInfo: hiddenContext
              };
              persistedText = actionText || quotedCaption || "[hidetag documento]";
            }
          }
        }
      }

      if (content) {
        const sent = await runtime.sendWithReplyFallback({
          to: runtime.event.waGroupId ?? runtime.remoteJid,
          content,
          quotedMessage: runtime.message,
          logContext: buildActionLogContext(runtime, "hidetag", "group", responseActionId)
        });
        await runtime.persistOutboundMessage({
          tenantId: runtime.context.tenant.id,
          userId: runtime.context.user.id,
          groupId: runtime.context.group?.id,
          waUserId: runtime.waUserId,
          waGroupId: runtime.event.waGroupId,
          text: persistedText,
          waMessageId: sent.key.id,
          rawJson: sent
        });
        logOutbound(runtime, "hidetag", sent.key.id, persistedText, "group", responseActionId);
        resultLabel = `hidetag_${hidetagKind}`;
      }
    } catch (error) {
      runtime.logger.warn?.(
        runtime.withCategory("WARN", {
          action: "hidetag",
          waGroupId: runtime.event.waGroupId,
          responseActionId,
          error
        }),
        "failed to send hidetag"
      );
      replyText = "Não consegui reenviar essa mensagem com hidetag agora.";
      success = false;
      resultLabel = "hidetag_send_failed";
    }

    if (!replyText && resultLabel) {
      await recordModerationOutcome({
        runtime,
        action,
        success,
        result: resultLabel
      });
      return true;
    }
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

  if (!replyText && !shouldPersist) {
    await recordModerationOutcome({
      runtime,
      action,
      success,
      result: resultLabel
    });
    return true;
  }

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
  await recordModerationOutcome({
    runtime,
    action,
    success,
    result: resultLabel || replyText
  });
  return true;
};
