import { sendTextAndPersist } from "../context.js";
import { createProgressReactionLifecycle } from "../reaction-progress.js";
import type {
  DispatchTranscribedTextResult,
  ExecuteOutboundActionsInput,
  OutboundScope
} from "../types.js";

type AudioRuntimeAction = {
  kind: "audio_transcription";
  source: "inbound" | "quoted";
  mode: "transcribe_only" | "transcribe_and_route";
  allowCommandDispatch?: boolean;
  commandPrefix?: string;
  origin?: "command" | "auto";
};

type AudioMediaType = "audio" | "ptt";

type AudioSource = {
  payload: any;
  mediaType: AudioMediaType;
  durationSeconds?: number;
  byteLength?: number;
  mimeType?: string;
};

class AudioCapabilityError extends Error {
  readonly reason: string;
  readonly userMessage: string;

  constructor(input: { reason: string; userMessage: string }) {
    super(input.reason);
    this.reason = input.reason;
    this.userMessage = input.userMessage;
  }
}

const normalizeMessageType = (value?: string): string => (value ?? "").trim().toLowerCase();

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

const resolveAudioFromMessage = (rawMessage: any): Omit<AudioSource, "payload"> | null => {
  const audio = rawMessage?.audioMessage;
  if (!audio || typeof audio !== "object") return null;
  const durationSeconds = toNumber(audio.seconds);
  const byteLength = toNumber(audio.fileLength);
  const mimeType = typeof audio.mimetype === "string" ? audio.mimetype : undefined;
  const mediaType: AudioMediaType = audio.ptt ? "ptt" : "audio";
  return { mediaType, durationSeconds, byteLength, mimeType };
};

const resolveAudioSource = (runtime: ExecuteOutboundActionsInput, action: AudioRuntimeAction): AudioSource | null => {
  if (action.source === "inbound") {
    const resolved = resolveAudioFromMessage(runtime.message?.message);
    if (!resolved) return null;
    return {
      ...resolved,
      payload: runtime.message
    };
  }

  const quoted = runtime.contextInfo?.quotedMessage;
  if (!quoted) return null;
  const quotedType = normalizeMessageType(quoted ? Object.keys(quoted)[0] : "");
  if (quotedType !== "audiomessage") return null;
  const resolved = resolveAudioFromMessage(quoted);
  if (!resolved) return null;
  const quotedKey = {
    remoteJid: runtime.remoteJid,
    id: runtime.quotedWaMessageId ?? runtime.event.quotedWaMessageId ?? runtime.message?.key?.id ?? `${Date.now()}`,
    fromMe: false,
    participant: runtime.quotedWaUserId ?? runtime.event.quotedWaUserId ?? undefined
  };
  return {
    ...resolved,
    payload: { key: quotedKey, message: quoted }
  };
};

const enforceAudioLimits = (runtime: ExecuteOutboundActionsInput, source: AudioSource): void => {
  const maxDuration = Math.max(1, Math.trunc(runtime.audioConfig.maxDurationSeconds));
  const maxBytes = Math.max(1, Math.trunc(runtime.audioConfig.maxBytes));
  if (source.durationSeconds !== undefined && source.durationSeconds > maxDuration) {
    throw new AudioCapabilityError({
      reason: "audio_duration_exceeded",
      userMessage: `Áudio muito longo. O limite atual é ${maxDuration}s.`
    });
  }
  if (source.byteLength !== undefined && source.byteLength > maxBytes) {
    throw new AudioCapabilityError({
      reason: "audio_size_exceeded",
      userMessage: "Este áudio excede o tamanho suportado. Envie um áudio menor."
    });
  }
};

const safePreview = (value: string, maxChars: number): string => value.replace(/\s+/g, " ").trim().slice(0, Math.max(16, maxChars));

const normalizeFailure = (error: unknown): { reason: string; userMessage: string } => {
  if (error instanceof AudioCapabilityError) {
    return { reason: error.reason, userMessage: error.userMessage };
  }
  return {
    reason: "audio_processing_failed",
    userMessage: "Não consegui processar o áudio agora. Tente novamente em instantes."
  };
};

type CommandCandidate = {
  commandText: string;
  confidence: number;
  reason: "prefixed" | "spoken_slash" | "keyword_allowlist";
};

const stripLeadingCommandWord = (value: string): string => value.replace(/^[\s/]+/, "").trim();

const resolveCommandCandidate = (runtime: ExecuteOutboundActionsInput, transcript: string): CommandCandidate | null => {
  const trimmed = transcript.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const prefix = runtime.audioConfig.commandPrefix || runtime.commandPrefix || "/";
  const lower = trimmed.toLowerCase();

  if (trimmed.startsWith(prefix)) {
    return { commandText: trimmed, confidence: 1, reason: "prefixed" };
  }

  const spokenSlash = trimmed.match(/^(?:slash|barra)\s+(.+)$/i);
  if (spokenSlash?.[1]) {
    const body = stripLeadingCommandWord(spokenSlash[1]);
    if (body) return { commandText: `${prefix}${body}`, confidence: 0.95, reason: "spoken_slash" };
  }

  const tokens = lower.split(/\s+/).filter(Boolean);
  const first = tokens[0];
  if (!first) return null;
  const allowlist = new Set(runtime.audioConfig.commandAllowlist.map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (!allowlist.has(first)) return null;
  const confidence = tokens.length <= 4 ? 0.82 : 0.68;
  return {
    commandText: `${prefix}${stripLeadingCommandWord(trimmed)}`,
    confidence,
    reason: "keyword_allowlist"
  };
};

const logBase = (runtime: ExecuteOutboundActionsInput, input: { responseActionId: string; mediaType?: AudioMediaType }) => ({
  tenantId: runtime.event.tenantId,
  waGroupId: runtime.event.waGroupId,
  waUserId: runtime.waUserId,
  inboundWaMessageId: runtime.event.waMessageId,
  executionId: runtime.event.executionId,
  responseActionId: input.responseActionId,
  capability: "audio",
  mediaType: input.mediaType
});

const hasResponses = (result: DispatchTranscribedTextResult): boolean => Boolean(result.hadResponses);

const sendTranscriptFallback = async (input: {
  runtime: ExecuteOutboundActionsInput;
  scope: OutboundScope;
  target: string;
  responseActionId: string;
  transcript: string;
  askRephrase?: boolean;
}) => {
  const preview = safePreview(input.transcript, input.runtime.audioConfig.transcriptPreviewChars);
  const lines = [`Transcrição: "${preview}${preview.length < input.transcript.trim().length ? "..." : ""}"`];
  if (input.askRephrase) {
    lines.push("Se você queria executar um comando, tente começar com 'slash <comando>' ou use o prefixo.");
  }
  await sendTextAndPersist({
    runtime: input.runtime,
    to: input.target,
    text: lines.join("\n"),
    actionName: "audio_transcription_preview",
    scope: input.scope,
    responseActionId: input.responseActionId
  });
};

export const handleAudioOutboundAction = async (input: {
  runtime: ExecuteOutboundActionsInput;
  action: any;
  responseActionId: string;
}): Promise<boolean> => {
  const { runtime, action, responseActionId } = input;
  if (action.kind !== "audio_transcription") return false;
  const typedAction = action as AudioRuntimeAction;
  const scope: OutboundScope = runtime.isGroup ? "group" : "direct";
  const target = runtime.isGroup ? runtime.remoteJid : runtime.waUserId;

  if (!runtime.audioConfig.enabled || !runtime.speechToText) {
    await sendTextAndPersist({
      runtime,
      to: target,
      text: "Capability de áudio indisponível no momento.",
      actionName: "audio_transcription_unavailable",
      scope,
      responseActionId
    });
    return true;
  }

  const progress = createProgressReactionLifecycle({
    runtime,
    responseActionId,
    actionName: "audio_transcription"
  });
  await progress.start();

  const source = resolveAudioSource(runtime, typedAction);
  if (!source) {
    await progress.failure();
    await sendTextAndPersist({
      runtime,
      to: target,
      text: "Não encontrei áudio válido. Responda um áudio para usar /transcribe ou envie um áudio direto.",
      actionName: "audio_transcription_error",
      scope,
      responseActionId
    });
    runtime.logger.info?.(
      runtime.withCategory("WA-OUT", {
        ...logBase(runtime, { responseActionId }),
        action: "transcribe",
        status: "failure",
        reason: "invalid_audio_source"
      }),
      "audio capability"
    );
    return true;
  }

  try {
    enforceAudioLimits(runtime, source);
    const socket = runtime.getSocket();
    if (!socket) {
      throw new AudioCapabilityError({
        reason: "socket_unavailable",
        userMessage: "Socket indisponível no momento. Tente novamente em instantes."
      });
    }

    const sock = socket as any;
    const reuploadRequest = typeof sock.updateMediaMessage === "function" ? sock.updateMediaMessage.bind(sock) : undefined;
    const downloaded = await runtime.downloadMediaMessage(source.payload, "buffer", {}, { logger: runtime.baileysLogger, reuploadRequest });
    const audioBuffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as Uint8Array);
    if (!audioBuffer.length) {
      throw new AudioCapabilityError({
        reason: "empty_audio_payload",
        userMessage: "Não consegui ler o conteúdo deste áudio. Tente enviar novamente."
      });
    }

    const startedAt = Date.now();
    const sttResult = await runtime.speechToText.transcribe({
      audio: audioBuffer,
      mimeType: source.mimeType,
      timeoutMs: runtime.audioConfig.sttTimeoutMs,
      model: runtime.audioConfig.sttModel,
      language: runtime.audioConfig.language
    });
    const transcript = sttResult.text?.trim();
    runtime.logger.info?.(
      runtime.withCategory("WA-OUT", {
        ...logBase(runtime, { responseActionId, mediaType: source.mediaType }),
        action: "transcribe",
        status: transcript ? "success" : "failure",
        transcriptPreview: transcript ? safePreview(transcript, runtime.audioConfig.transcriptPreviewChars) : "",
        elapsedMs: sttResult.elapsedMs ?? Date.now() - startedAt
      }),
      "audio capability"
    );

    if (!transcript) {
      await progress.failure();
      await sendTextAndPersist({
        runtime,
        to: target,
        text: "A transcrição ficou vazia ou inconclusiva. Tente falar mais próximo do microfone.",
        actionName: "audio_transcription_empty",
        scope,
        responseActionId
      });
      return true;
    }

    if (typedAction.mode === "transcribe_only") {
      await sendTextAndPersist({
        runtime,
        to: target,
        text: `Transcrição:\n${transcript}`,
        actionName: "audio_transcription_text",
        scope,
        responseActionId
      });
      await progress.success();
      return true;
    }

    const allowDispatch = runtime.audioConfig.commandDispatchEnabled && typedAction.allowCommandDispatch !== false;
    const candidate = allowDispatch ? resolveCommandCandidate(runtime, transcript) : null;
    if (candidate && candidate.confidence >= runtime.audioConfig.commandMinConfidence) {
      const dispatchResult = await runtime.dispatchTranscribedText({
        text: candidate.commandText,
        transcript,
        commandText: candidate.commandText,
        action: "dispatch_command"
      });
      runtime.logger.info?.(
        runtime.withCategory("WA-OUT", {
          ...logBase(runtime, { responseActionId, mediaType: source.mediaType }),
          action: "dispatch_command",
          status: hasResponses(dispatchResult) ? "success" : "failure",
          commandExecutionId: dispatchResult.dispatchExecutionId,
          transcriptPreview: safePreview(transcript, runtime.audioConfig.transcriptPreviewChars),
          dispatchTextPreview: safePreview(candidate.commandText, runtime.audioConfig.transcriptPreviewChars),
          dispatchReason: candidate.reason,
          confidence: candidate.confidence
        }),
        "audio capability"
      );

      if (!hasResponses(dispatchResult)) {
        await sendTranscriptFallback({
          runtime,
          scope,
          target,
          responseActionId,
          transcript,
          askRephrase: true
        });
      }
      await progress.success();
      return true;
    }

    if (candidate && candidate.confidence < runtime.audioConfig.commandMinConfidence) {
      runtime.logger.info?.(
        runtime.withCategory("WA-OUT", {
          ...logBase(runtime, { responseActionId, mediaType: source.mediaType }),
          action: "dispatch_command",
          status: "failure",
          reason: "insufficient_confidence",
          transcriptPreview: safePreview(transcript, runtime.audioConfig.transcriptPreviewChars),
          dispatchTextPreview: safePreview(candidate.commandText, runtime.audioConfig.transcriptPreviewChars),
          confidence: candidate.confidence,
          minConfidence: runtime.audioConfig.commandMinConfidence
        }),
        "audio capability"
      );
    }

    const prefixedCommandWhenDispatchOff =
      !allowDispatch &&
      (transcript.trim().startsWith(runtime.audioConfig.commandPrefix) || transcript.trim().startsWith(runtime.commandPrefix));
    const textForResponse = prefixedCommandWhenDispatchOff
      ? stripLeadingCommandWord(transcript.trim().slice((runtime.audioConfig.commandPrefix || runtime.commandPrefix || "/").length))
      : transcript;

    const respondResult = await runtime.dispatchTranscribedText({
      text: textForResponse || transcript,
      transcript,
      action: "respond"
    });
    runtime.logger.info?.(
      runtime.withCategory("WA-OUT", {
        ...logBase(runtime, { responseActionId, mediaType: source.mediaType }),
        action: "respond",
        status: hasResponses(respondResult) ? "success" : "failure",
        commandExecutionId: respondResult.dispatchExecutionId,
        transcriptPreview: safePreview(transcript, runtime.audioConfig.transcriptPreviewChars)
      }),
      "audio capability"
    );

    if (!hasResponses(respondResult)) {
      await sendTranscriptFallback({
        runtime,
        scope,
        target,
        responseActionId,
        transcript,
        askRephrase: candidate !== null
      });
    }
    await progress.success();
    return true;
  } catch (error) {
    await progress.failure();
    const failure = normalizeFailure(error);
    runtime.logger.warn?.(
      runtime.withCategory("WA-OUT", {
        ...logBase(runtime, { responseActionId, mediaType: source.mediaType }),
        action: "transcribe",
        status: "failure",
        reason: failure.reason,
        err: error
      }),
      "audio capability"
    );
    await sendTextAndPersist({
      runtime,
      to: target,
      text: failure.userMessage,
      actionName: "audio_transcription_error",
      scope,
      responseActionId
    });
    return true;
  }
};
