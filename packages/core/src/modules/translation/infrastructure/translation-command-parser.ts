import type { TranslationCommandInput } from "../domain/translation-request.js";
import { normalizeLanguageTag, normalizeMode } from "../domain/translation-request.js";
import { resolvePrimarySegmentTextFromReply, type ReplyContextInput } from "../../../common/reply-context-input.js";

export type TranslationCommandParseFailureReason =
  | "missing_text"
  | "incompatible_reply"
  | "too_many_segments"
  | "malformed_command";

export type TranslationCommandParseResult =
  | { ok: true; value: TranslationCommandInput }
  | { ok: false; reason: TranslationCommandParseFailureReason };

const isFullToken = (value: string): boolean => normalizeMode(value) === "full";

export const parseTranslationCommand = (
  commandBody: string,
  input?: { replyContext?: ReplyContextInput }
): TranslationCommandParseResult => {
  const args = commandBody.replace(/^trl\b/i, "").trim();
  const segments = (args ? args.split("|") : [""]).map((segment) => segment.trim());
  if (segments.length > 3) return { ok: false, reason: "too_many_segments" };

  const resolvedPrimary = resolvePrimarySegmentTextFromReply({
    segments,
    replyContext: input?.replyContext
  });

  if (!resolvedPrimary.ok) {
    return { ok: false, reason: resolvedPrimary.reason === "incompatible_reply" ? "incompatible_reply" : "missing_text" };
  }

  const normalizedSegments = resolvedPrimary.segments;
  const second = normalizedSegments[1] ?? "";
  const third = normalizedSegments[2] ?? "";

  if (normalizedSegments.length === 2 && !second) {
    return { ok: false, reason: "malformed_command" };
  }

  if (normalizedSegments.length === 3 && !third && !second) {
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
    if (!isFullToken(third)) {
      return { ok: false, reason: "malformed_command" };
    }
    mode = "full";
  }

  return {
    ok: true,
    value: {
      text: resolvedPrimary.text,
      targetLanguage,
      mode
    }
  };
};
