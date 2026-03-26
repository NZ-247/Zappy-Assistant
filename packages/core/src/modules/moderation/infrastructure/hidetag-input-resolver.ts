import type { HidetagContentPayload } from "../../../pipeline/actions.js";
import { normalizeMessageType } from "../../../common/reply-context-input.js";

export interface HidetagReplyContextInput {
  quotedWaMessageId?: string;
  quotedMessageType?: string;
  quotedText?: string;
  quotedHasMedia?: boolean;
  quotedAudioPtt?: boolean;
}

export type HidetagInputResolutionFailureReason = "missing_input" | "incompatible_reply" | "unsupported_reply_media";

export type HidetagInputResolution =
  | { ok: true; payload: HidetagContentPayload }
  | { ok: false; reason: HidetagInputResolutionFailureReason };

const normalizeText = (value?: string): string => (value ?? "").replace(/\s+/g, " ").trim();

const mediaTypeMap: Record<string, Exclude<HidetagContentPayload["kind"], "reply_audio">> = {
  imagemessage: "reply_image",
  audiomessage: "reply_ptt",
  stickermessage: "reply_sticker",
  videomessage: "reply_video",
  documentmessage: "reply_document"
};

export const resolveHidetagInput = (input: {
  explicitText?: string;
  replyContext?: HidetagReplyContextInput;
}): HidetagInputResolution => {
  const explicitText = normalizeText(input.explicitText);
  if (explicitText) {
    return {
      ok: true,
      payload: {
        kind: "text",
        text: explicitText
      }
    };
  }

  const replyContext = input.replyContext;
  if (replyContext?.quotedWaMessageId) {
    const normalizedType = normalizeMessageType(replyContext.quotedMessageType);
    const mediaKind = mediaTypeMap[normalizedType];
    if (mediaKind) {
      const resolvedKind: HidetagContentPayload["kind"] =
        normalizedType === "audiomessage" && !replyContext.quotedAudioPtt ? "reply_audio" : mediaKind;
      return {
        ok: true,
        payload: {
          kind: resolvedKind
        }
      };
    }

    const repliedText = normalizeText(replyContext.quotedText);
    if (repliedText) {
      return {
        ok: true,
        payload: {
          kind: "reply_text",
          text: repliedText
        }
      };
    }

    if (replyContext.quotedHasMedia) {
      return { ok: false, reason: "unsupported_reply_media" };
    }

    return { ok: false, reason: "incompatible_reply" };
  }

  return { ok: false, reason: "missing_input" };
};
