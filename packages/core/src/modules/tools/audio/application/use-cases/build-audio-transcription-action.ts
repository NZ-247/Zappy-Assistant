import type {
  AudioTranscriptionAction,
  AudioTranscriptionMode,
  AudioTranscriptionSource
} from "../../../../../pipeline/actions.js";

const buildAction = (input: {
  source: AudioTranscriptionSource;
  mode: AudioTranscriptionMode;
  allowCommandDispatch: boolean;
  commandPrefix: string;
  origin: "command" | "auto";
}): AudioTranscriptionAction => ({
  kind: "audio_transcription",
  source: input.source,
  mode: input.mode,
  allowCommandDispatch: input.allowCommandDispatch,
  commandPrefix: input.commandPrefix,
  origin: input.origin
});

export const buildTranscribeOnlyAction = (input: {
  source: AudioTranscriptionSource;
  commandPrefix: string;
}): AudioTranscriptionAction =>
  buildAction({
    source: input.source,
    mode: "transcribe_only",
    allowCommandDispatch: false,
    commandPrefix: input.commandPrefix,
    origin: "command"
  });

export const buildTranscribeAndRouteAction = (input: {
  source: AudioTranscriptionSource;
  commandPrefix: string;
  allowCommandDispatch: boolean;
}): AudioTranscriptionAction =>
  buildAction({
    source: input.source,
    mode: "transcribe_and_route",
    allowCommandDispatch: input.allowCommandDispatch,
    commandPrefix: input.commandPrefix,
    origin: "auto"
  });
