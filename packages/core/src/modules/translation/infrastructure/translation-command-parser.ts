import type { TranslationCommandInput } from "../domain/translation-request.js";
import { normalizeLanguageTag, normalizeMode, normalizeTranslationText } from "../domain/translation-request.js";
import { isAudioMessageType, type ReplyContextInput, type ReplyInputSource } from "../../../common/reply-context-input.js";

export type TranslationCommandParseFailureReason =
  | "missing_text"
  | "incompatible_reply"
  | "too_many_segments"
  | "malformed_command";

export type TranslationCommandResolvedInput =
  | {
      kind: "text";
      source: ReplyInputSource;
      request: TranslationCommandInput;
    }
  | {
      kind: "audio_reply";
      source: "quoted";
      targetLanguage?: string;
      mode?: "basic" | "full";
    };

export type TranslationCommandParseResult =
  | { ok: true; value: TranslationCommandResolvedInput }
  | { ok: false; reason: TranslationCommandParseFailureReason };

const isFullToken = (value: string): boolean => normalizeMode(value) === "full";

export const parseTranslationCommand = (
  commandBody: string,
  input?: { replyContext?: ReplyContextInput }
): TranslationCommandParseResult => {
  const args = commandBody.replace(/^trl\b/i, "").trim();
  const segments = (args ? args.split("|") : [""]).map((segment) => segment.trim());
  if (segments.length > 3) return { ok: false, reason: "too_many_segments" };

  const first = segments[0] ?? "";
  const second = segments[1] ?? "";
  const third = segments[2] ?? "";

  if (segments.length === 2 && !second) {
    return { ok: false, reason: "malformed_command" };
  }

  if (segments.length === 3 && !third && !second) {
    return { ok: false, reason: "malformed_command" };
  }

  let targetLanguage: string | undefined;
  let mode: "basic" | "full" = "basic";

  if (second) {
    if (isFullToken(second)) {
      mode = "full";
    } else {
      targetLanguage = normalizeLanguageTag(second);
    }
  }

  if (third) {
    if (isFullToken(second)) {
      return { ok: false, reason: "malformed_command" };
    }
    if (!isFullToken(third)) {
      return { ok: false, reason: "malformed_command" };
    }
    mode = "full";
  }

  const explicitText = normalizeTranslationText(first);
  if (explicitText) {
    return {
      ok: true,
      value: {
        kind: "text",
        source: "explicit",
        request: {
          text: explicitText,
          targetLanguage,
          mode
        }
      }
    };
  }

  const repliedText = normalizeTranslationText(input?.replyContext?.quotedText ?? "");
  if (repliedText) {
    return {
      ok: true,
      value: {
        kind: "text",
        source: "reply",
        request: {
          text: repliedText,
          targetLanguage,
          mode
        }
      }
    };
  }

  if (input?.replyContext?.quotedWaMessageId) {
    if (isAudioMessageType(input.replyContext.quotedMessageType)) {
      return {
        ok: true,
        value: {
          kind: "audio_reply",
          source: "quoted",
          targetLanguage,
          mode
        }
      };
    }
    return { ok: false, reason: "incompatible_reply" };
  }

  return { ok: false, reason: "missing_text" };
};
