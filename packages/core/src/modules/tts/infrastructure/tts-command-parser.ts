import type { TtsCommandInput } from "../domain/tts-request.js";
import { resolvePrimarySegmentTextFromReply, type ReplyContextInput } from "../../../common/reply-context-input.js";

export type TtsCommandParseFailureReason =
  | "missing_text"
  | "incompatible_reply"
  | "too_many_segments"
  | "malformed_command";

export type TtsCommandParseResult =
  | { ok: true; value: TtsCommandInput }
  | { ok: false; reason: TtsCommandParseFailureReason };

const VOICE_SHORTCUTS = new Set(["male", "female"]);
const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const VOICE_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{2,40}$/;

const isLanguageToken = (value: string): boolean => LANGUAGE_PATTERN.test(value.trim());
const isVoiceToken = (value: string): boolean => VOICE_TOKEN_PATTERN.test(value.trim()) && !isLanguageToken(value);

export const parseTtsCommand = (
  commandBody: string,
  input?: { replyContext?: ReplyContextInput }
): TtsCommandParseResult => {
  const args = commandBody.replace(/^tts\b/i, "").trim();
  const segments = (args ? args.split("|") : [""]).map((segment) => segment.trim());
  if (segments.length > 4) return { ok: false, reason: "too_many_segments" };

  const resolvedPrimary = resolvePrimarySegmentTextFromReply({
    segments,
    replyContext: input?.replyContext
  });

  if (!resolvedPrimary.ok) {
    return { ok: false, reason: resolvedPrimary.reason === "incompatible_reply" ? "incompatible_reply" : "missing_text" };
  }

  const normalizedSegments = resolvedPrimary.segments;
  const text = normalizedSegments[0] ?? "";

  if (normalizedSegments.length === 1) {
    return { ok: true, value: { text } };
  }

  const second = normalizedSegments[1] ?? "";
  const third = normalizedSegments[2] ?? "";
  const fourth = normalizedSegments[3] ?? "";

  if (normalizedSegments.length === 2) {
    if (!second) return { ok: false, reason: "malformed_command" };
    if (isLanguageToken(second)) {
      return { ok: true, value: { text, targetLanguage: second, language: second } };
    }
    if (VOICE_SHORTCUTS.has(second.toLowerCase()) || isVoiceToken(second)) {
      return { ok: true, value: { text, voice: second } };
    }
    return { ok: false, reason: "malformed_command" };
  }

  if (normalizedSegments.length === 3) {
    if (!second || !third) return { ok: false, reason: "malformed_command" };
    if (isLanguageToken(third)) {
      return {
        ok: true,
        value: {
          text,
          sourceLanguage: second,
          targetLanguage: third,
          language: third
        }
      };
    }
    return {
      ok: true,
      value: {
        text,
        targetLanguage: second,
        language: second,
        voice: third
      }
    };
  }

  if (!second || !third) return { ok: false, reason: "malformed_command" };

  return {
    ok: true,
    value: {
      text,
      sourceLanguage: second,
      targetLanguage: third,
      language: third,
      voice: fourth || undefined
    }
  };
};
