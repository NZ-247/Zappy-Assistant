import {
  AudioTranscodingError,
  inspectAudioPayload,
  type AudioPayloadProbe,
  transcodeToWhatsAppPtt
} from "./wa-audio-transcoding.js";

const normalizeMimeType = (value?: string): string => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || "application/octet-stream";
};

const normalizeTranscodeReason = (error: unknown): string => {
  if (error instanceof AudioTranscodingError) return error.reason;
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || "ptt_transcode_failed";
  }
  return "ptt_transcode_failed";
};

const isAlreadyPttCompatible = (probe: AudioPayloadProbe): boolean => {
  const mimeType = normalizeMimeType(probe.mimeType);
  return probe.container === "ogg" && mimeType.startsWith("audio/ogg") && (mimeType.includes("codecs=opus") || probe.codecGuess === "opus");
};

export interface PrepareWhatsAppAudioForSendInput {
  audioBuffer: Buffer;
  mimeType?: string;
  requestPtt: boolean;
}

export interface PreparedWhatsAppAudioForSend {
  audioBuffer: Buffer;
  mimeType: string;
  ptt: boolean;
  transcodedToPtt: boolean;
  transcodeReason?: string;
  inputProbe: AudioPayloadProbe;
  outputProbe: AudioPayloadProbe;
}

export const prepareWhatsAppAudioForSend = async (
  input: PrepareWhatsAppAudioForSendInput
): Promise<PreparedWhatsAppAudioForSend> => {
  const requestedMimeType = normalizeMimeType(input.mimeType);
  const inputProbe = inspectAudioPayload({
    audioBuffer: input.audioBuffer,
    mimeType: requestedMimeType
  });

  if (!input.requestPtt) {
    return {
      audioBuffer: input.audioBuffer,
      mimeType: requestedMimeType,
      ptt: false,
      transcodedToPtt: false,
      inputProbe,
      outputProbe: inputProbe
    };
  }

  if (isAlreadyPttCompatible(inputProbe)) {
    return {
      audioBuffer: input.audioBuffer,
      mimeType: "audio/ogg; codecs=opus",
      ptt: true,
      transcodedToPtt: false,
      inputProbe,
      outputProbe: inspectAudioPayload({
        audioBuffer: input.audioBuffer,
        mimeType: "audio/ogg; codecs=opus"
      })
    };
  }

  try {
    const normalized = await transcodeToWhatsAppPtt({
      audioBuffer: input.audioBuffer,
      mimeType: requestedMimeType
    });
    return {
      audioBuffer: normalized.audioBuffer,
      mimeType: normalized.mimeType,
      ptt: true,
      transcodedToPtt: normalized.transcoded,
      inputProbe: normalized.inputProbe,
      outputProbe: inspectAudioPayload({
        audioBuffer: normalized.audioBuffer,
        mimeType: normalized.mimeType
      })
    };
  } catch (error) {
    return {
      audioBuffer: input.audioBuffer,
      mimeType: requestedMimeType,
      ptt: false,
      transcodedToPtt: false,
      transcodeReason: normalizeTranscodeReason(error),
      inputProbe,
      outputProbe: inspectAudioPayload({
        audioBuffer: input.audioBuffer,
        mimeType: requestedMimeType
      })
    };
  }
};
