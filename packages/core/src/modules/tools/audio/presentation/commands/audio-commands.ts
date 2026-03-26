import type { ResponseAction } from "../../../../../pipeline/actions.js";
import type { PipelineContext } from "../../../../../pipeline/context.js";
import type { AudioModuleConfigPort } from "../../ports.js";
import { buildTranscribeOnlyAction } from "../../application/use-cases/build-audio-transcription-action.js";
import { resolveAudioInputSource } from "../../../../../common/reply-context-input.js";

export interface AudioCommandDeps {
  config: AudioModuleConfigPort;
  formatUsage?: (command: "transcribe" | "tss") => string | null;
  stylizeReply?: (text: string) => string;
}

const replyText = (deps: AudioCommandDeps, text: string): ResponseAction[] => {
  const formatted = deps.stylizeReply ? deps.stylizeReply(text) : text;
  return [{ kind: "reply_text", text: formatted }];
};

export const handleAudioCommand = (input: {
  commandKey: string;
  ctx: PipelineContext;
  deps: AudioCommandDeps;
}): ResponseAction[] | null => {
  const { commandKey, ctx, deps } = input;
  if (commandKey !== "transcribe") return null;
  if (!deps.config.capabilityEnabled) {
    return replyText(deps, "Capability de áudio está desativada neste ambiente.");
  }

  const audioSource = resolveAudioInputSource({
    inboundMessageType: ctx.event.rawMessageType,
    replyContext: {
      quotedWaMessageId: ctx.event.quotedWaMessageId,
      quotedMessageType: ctx.event.quotedMessageType,
      quotedText: ctx.event.quotedText,
      quotedHasMedia: ctx.event.quotedHasMedia
    }
  });

  if (audioSource.ok) {
    return [buildTranscribeOnlyAction({ source: audioSource.source, commandPrefix: deps.config.commandPrefix })];
  }

  const usage = deps.formatUsage?.("transcribe") ?? deps.formatUsage?.("tss");
  if (audioSource.reason === "incompatible_reply") {
    return replyText(
      deps,
      usage ??
        "Esse comando transcreve audio. Responda um audio com /transcribe (ou /tss), ou envie audio direto para transcricao automatica."
    );
  }

  return replyText(
    deps,
    usage ??
      "Uso correto: transcribe respondendo um áudio. Você também pode enviar áudio direto para transcrição automática."
  );
};
