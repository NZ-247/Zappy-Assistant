export interface ReplyContextInput {
  quotedWaMessageId?: string;
  quotedMessageType?: string;
  quotedText?: string;
  quotedHasMedia?: boolean;
}

export type ReplyInputSource = "explicit" | "reply";

export type TextInputResolutionFailureReason = "missing_input" | "incompatible_reply";

export type TextInputResolution =
  | { ok: true; text: string; source: ReplyInputSource }
  | { ok: false; reason: TextInputResolutionFailureReason };

export type AudioInputResolutionFailureReason = "missing_audio" | "incompatible_reply";

export type AudioInputResolution =
  | { ok: true; source: "inbound" | "quoted" }
  | { ok: false; reason: AudioInputResolutionFailureReason };

const normalizeInlineText = (value?: string): string => (value ?? "").replace(/\s+/g, " ").trim();

const normalizeMessageType = (value?: string): string => (value ?? "").trim().toLowerCase();

const isAudioMessageType = (value?: string): boolean => normalizeMessageType(value) === "audiomessage";

export const resolveTextInputFromExplicitOrReply = (input: {
  explicitText?: string;
  replyContext?: ReplyContextInput;
}): TextInputResolution => {
  const explicit = normalizeInlineText(input.explicitText);
  if (explicit) {
    return { ok: true, text: explicit, source: "explicit" };
  }

  const replyText = normalizeInlineText(input.replyContext?.quotedText);
  if (replyText) {
    return { ok: true, text: replyText, source: "reply" };
  }

  if (input.replyContext?.quotedWaMessageId) {
    return { ok: false, reason: "incompatible_reply" };
  }

  return { ok: false, reason: "missing_input" };
};

export const resolvePrimarySegmentTextFromReply = (input: {
  segments: string[];
  replyContext?: ReplyContextInput;
}):
  | { ok: true; text: string; source: ReplyInputSource; segments: string[] }
  | { ok: false; reason: TextInputResolutionFailureReason } => {
  const segments = [...input.segments];
  const first = segments[0] ?? "";
  const resolved = resolveTextInputFromExplicitOrReply({
    explicitText: first,
    replyContext: input.replyContext
  });

  if (!resolved.ok) return resolved;

  segments[0] = resolved.text;
  return {
    ok: true,
    text: resolved.text,
    source: resolved.source,
    segments
  };
};

export const resolveAudioInputSource = (input: {
  inboundMessageType?: string;
  replyContext?: ReplyContextInput;
}): AudioInputResolution => {
  if (isAudioMessageType(input.inboundMessageType)) {
    return { ok: true, source: "inbound" };
  }

  if (input.replyContext?.quotedWaMessageId && isAudioMessageType(input.replyContext.quotedMessageType)) {
    return { ok: true, source: "quoted" };
  }

  if (input.replyContext?.quotedWaMessageId) {
    return { ok: false, reason: "incompatible_reply" };
  }

  return { ok: false, reason: "missing_audio" };
};

