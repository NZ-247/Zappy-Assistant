import type { TtsCommandInput } from "../domain/tts-request.js";

export type TtsCommandParseFailureReason =
  | "missing_text"
  | "too_many_segments"
  | "malformed_command";

export type TtsCommandParseResult =
  | { ok: true; value: TtsCommandInput }
  | { ok: false; reason: TtsCommandParseFailureReason };

const VOICE_SHORTCUTS = new Set(["male", "female"]);

export const parseTtsCommand = (commandBody: string): TtsCommandParseResult => {
  const args = commandBody.replace(/^tts\b/i, "").trim();
  if (!args) return { ok: false, reason: "missing_text" };

  const segments = args.split("|").map((segment) => segment.trim());
  if (segments.length > 3) return { ok: false, reason: "too_many_segments" };

  const text = segments[0] ?? "";
  if (!text) return { ok: false, reason: "missing_text" };

  if (segments.length === 1) {
    return { ok: true, value: { text } };
  }

  const second = segments[1] ?? "";
  const third = segments[2] ?? "";

  if (segments.length === 2) {
    if (!second) return { ok: false, reason: "malformed_command" };
    if (VOICE_SHORTCUTS.has(second.toLowerCase())) {
      return { ok: true, value: { text, voice: second } };
    }
    return { ok: true, value: { text, language: second } };
  }

  return {
    ok: true,
    value: {
      text,
      language: second || undefined,
      voice: third || undefined
    }
  };
};
