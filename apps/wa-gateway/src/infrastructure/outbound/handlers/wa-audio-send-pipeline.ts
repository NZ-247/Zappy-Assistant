import {
  AudioTranscodingError,
  inspectAudioPayload,
  type AudioPayloadProbe,
  transcodeToWhatsAppPtt
} from "./wa-audio-transcoding.js";

export const CANONICAL_VOICE_NOTE_PIPELINE_ID = "wa_voice_note_v1";
export const WHATSAPP_VOICE_NOTE_MIME_TYPE = "audio/ogg; codecs=opus";

const normalizeMimeType = (value?: string): string => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || "application/octet-stream";
};

const normalizeTranscodeReason = (error: unknown): string => {
  if (error instanceof AudioTranscodingError) return error.reason;
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || "voice_note_normalization_failed";
  }
  return "voice_note_normalization_failed";
};

const isAlreadyPttCompatible = (probe: AudioPayloadProbe): boolean => {
  const mimeType = normalizeMimeType(probe.mimeType);
  return probe.container === "ogg" && mimeType.startsWith("audio/ogg") && (mimeType.includes("codecs=opus") || probe.codecGuess === "opus");
};

type TranscodeToWhatsAppPtt = typeof transcodeToWhatsAppPtt;

export interface NormalizeAssistantAudioToVoiceNoteInput {
  audioBuffer: Buffer;
  mimeType?: string;
  sourceFlow: string;
  timeoutMs?: number;
  transcodeFn?: TranscodeToWhatsAppPtt;
}

export interface VoiceNoteNormalizationDiagnostics {
  canonicalPipeline: typeof CANONICAL_VOICE_NOTE_PIPELINE_ID;
  sourceFlow: string;
  inputMimeTypeHint: string;
  inputProbe: AudioPayloadProbe;
  outputProbe: AudioPayloadProbe;
  transcoded: boolean;
}

export interface NormalizedAssistantVoiceNote {
  audioBuffer: Buffer;
  mimeType: typeof WHATSAPP_VOICE_NOTE_MIME_TYPE;
  ptt: true;
  diagnostics: VoiceNoteNormalizationDiagnostics;
}

export class VoiceNoteNormalizationError extends Error {
  readonly reason: string;
  readonly diagnostics: {
    canonicalPipeline: typeof CANONICAL_VOICE_NOTE_PIPELINE_ID;
    sourceFlow: string;
    inputMimeTypeHint: string;
    inputProbe: AudioPayloadProbe;
    transcoded: boolean;
  };

  constructor(input: {
    reason: string;
    sourceFlow: string;
    inputMimeTypeHint: string;
    inputProbe: AudioPayloadProbe;
    transcoded: boolean;
  }) {
    super(input.reason);
    this.reason = input.reason;
    this.diagnostics = {
      canonicalPipeline: CANONICAL_VOICE_NOTE_PIPELINE_ID,
      sourceFlow: input.sourceFlow,
      inputMimeTypeHint: input.inputMimeTypeHint,
      inputProbe: input.inputProbe,
      transcoded: input.transcoded
    };
  }
}

export const normalizeAssistantAudioToVoiceNote = async (
  input: NormalizeAssistantAudioToVoiceNoteInput
): Promise<NormalizedAssistantVoiceNote> => {
  const requestedMimeType = normalizeMimeType(input.mimeType);
  const inputProbe = inspectAudioPayload({
    audioBuffer: input.audioBuffer,
    mimeType: requestedMimeType
  });

  if (!input.audioBuffer.length) {
    throw new VoiceNoteNormalizationError({
      reason: "empty_audio_payload",
      sourceFlow: input.sourceFlow,
      inputMimeTypeHint: requestedMimeType,
      inputProbe,
      transcoded: false
    });
  }

  if (isAlreadyPttCompatible(inputProbe)) {
    const outputProbe = inspectAudioPayload({
      audioBuffer: input.audioBuffer,
      mimeType: WHATSAPP_VOICE_NOTE_MIME_TYPE
    });
    return {
      audioBuffer: input.audioBuffer,
      mimeType: WHATSAPP_VOICE_NOTE_MIME_TYPE,
      ptt: true,
      diagnostics: {
        canonicalPipeline: CANONICAL_VOICE_NOTE_PIPELINE_ID,
        sourceFlow: input.sourceFlow,
        inputMimeTypeHint: requestedMimeType,
        inputProbe,
        outputProbe,
        transcoded: false
      }
    };
  }

  try {
    const transcode = input.transcodeFn ?? transcodeToWhatsAppPtt;
    const normalized = await transcode({
      audioBuffer: input.audioBuffer,
      mimeType: requestedMimeType,
      timeoutMs: input.timeoutMs
    });
    const outputProbe = inspectAudioPayload({
      audioBuffer: normalized.audioBuffer,
      mimeType: normalized.mimeType
    });

    if (outputProbe.container !== "ogg" || outputProbe.codecGuess !== "opus") {
      throw new AudioTranscodingError("normalized_payload_incompatible");
    }

    return {
      audioBuffer: normalized.audioBuffer,
      mimeType: normalized.mimeType,
      ptt: true,
      diagnostics: {
        canonicalPipeline: CANONICAL_VOICE_NOTE_PIPELINE_ID,
        sourceFlow: input.sourceFlow,
        inputMimeTypeHint: requestedMimeType,
        inputProbe: normalized.inputProbe,
        outputProbe,
        transcoded: normalized.transcoded
      }
    };
  } catch (error) {
    throw new VoiceNoteNormalizationError({
      reason: normalizeTranscodeReason(error),
      sourceFlow: input.sourceFlow,
      inputMimeTypeHint: requestedMimeType,
      inputProbe,
      transcoded: true
    });
  }
};
