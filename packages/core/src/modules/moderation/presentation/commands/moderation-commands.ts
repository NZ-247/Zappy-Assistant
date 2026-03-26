import { resolveTargetUserFromMentionOrReply } from "../../../../common/bot-common.js";
import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import { parseDurationInput } from "../../../../time.js";
import { resolveHidetagInput } from "../../infrastructure/hidetag-input-resolver.js";
import {
  banUserAction,
  hideTagAction,
  kickUserAction,
  muteUserAction,
  unmuteUserAction
} from "../../application/use-cases/moderation-actions.js";

type ModerationCommandKey = "ban" | "kick" | "mute" | "unmute" | "hidetag";

export interface ModerationCommandDeps {
  requireGroup: () => ResponseAction[] | null;
  requireAdmin: () => ResponseAction[] | null;
  enforceBotAdmin: (command: string) => ResponseAction[] | null;
  stylizeReply: (text: string) => string;
  formatCmd: (body: string) => string;
}

export const handleModerationCommand = (
  input: {
    commandKey: string;
    lower: string;
    cmd: string;
    ctx: PipelineContext;
    deps: ModerationCommandDeps;
  }
): ResponseAction[] | null => {
  const { commandKey, lower, cmd, ctx, deps } = input;
  const { requireGroup, requireAdmin, enforceBotAdmin, stylizeReply, formatCmd } = deps;

  if (commandKey === "ban" || commandKey === "kick") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    const botAdminGuard = enforceBotAdmin(lower);
    if (botAdminGuard) return botAdminGuard;
    const target = resolveTargetUserFromMentionOrReply(ctx.event) ?? cmd.replace(/^(ban|kick)\s+/i, "").trim();
    if (!target) return [{ kind: "reply_text", text: stylizeReply("Mencione ou responda quem deseja remover.") }];
    const action =
      commandKey === "ban"
        ? banUserAction({ waGroupId: ctx.event.waGroupId!, targetWaUserId: target })
        : kickUserAction({ waGroupId: ctx.event.waGroupId!, targetWaUserId: target });
    return [action];
  }

  if (commandKey === "mute") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const rawArgs = cmd.replace(/^(mute)\s+/i, "").trim();
    const tokens = rawArgs.split(/\s+/).filter(Boolean);
    const mentionTarget = resolveTargetUserFromMentionOrReply(ctx.event);
    const tokenTarget = tokens.length > 1 ? tokens.shift() : undefined;
    const target = mentionTarget ?? tokenTarget;
    const durationToken = tokens[0];
    if (!target || !durationToken) {
      return null; // allow fallback to scoped mute handler
    }
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    const botAdminGuard = enforceBotAdmin(lower);
    if (botAdminGuard) return botAdminGuard;
    const duration = parseDurationInput(durationToken);
    if (!duration) return [{ kind: "reply_text", text: stylizeReply("Duração inválida. Ex: 30m, 1h.") }];
    return [muteUserAction({ waGroupId: ctx.event.waGroupId!, targetWaUserId: target, durationMs: duration.milliseconds })];
  }

  if (commandKey === "unmute") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    const botAdminGuard = enforceBotAdmin(lower);
    if (botAdminGuard) return botAdminGuard;
    const target = resolveTargetUserFromMentionOrReply(ctx.event) ?? cmd.replace(/^(unmute)\s+/i, "").trim();
    if (!target) return [{ kind: "reply_text", text: stylizeReply("Mencione ou responda quem deseja reativar.") }];
    return [unmuteUserAction({ waGroupId: ctx.event.waGroupId!, targetWaUserId: target })];
  }

  if (commandKey === "hidetag") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    const botAdminGuard = enforceBotAdmin(lower);
    if (botAdminGuard) return botAdminGuard;
    const resolved = resolveHidetagInput({
      explicitText: cmd.replace(/^(hidetag)\s*/i, "").trim(),
      replyContext: {
        quotedWaMessageId: ctx.event.quotedWaMessageId,
        quotedMessageType: ctx.event.quotedMessageType,
        quotedText: ctx.event.quotedText,
        quotedHasMedia: ctx.event.quotedHasMedia
      }
    });
    if (!resolved.ok) {
      if (resolved.reason === "unsupported_reply_media") {
        return [
          {
            kind: "reply_text",
            text: stylizeReply(
              "Tipo de mídia não suportado para hidetag. Responda texto, imagem, áudio, sticker, vídeo ou documento compatível."
            )
          }
        ];
      }
      return [
        {
          kind: "reply_text",
          text: stylizeReply(
            `Use ${formatCmd("hidetag")} <texto> ou responda uma mensagem de texto/mídia para reenviar com menção oculta.`
          )
        }
      ];
    }

    if (resolved.payload.kind === "text" || resolved.payload.kind === "reply_text") {
      return [
        hideTagAction({
          waGroupId: ctx.event.waGroupId!,
          text: resolved.payload.text,
          hidetagContent: resolved.payload
        })
      ];
    }

    return [
      hideTagAction({
        waGroupId: ctx.event.waGroupId!,
        hidetagContent: resolved.payload
      })
    ];
  }

  return null;
};
