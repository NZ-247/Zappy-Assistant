import type { ResponseAction } from "../../../../../pipeline/actions.js";
import type { PipelineContext } from "../../../../../pipeline/context.js";
import type { AudioModuleConfigPort } from "../../ports.js";
import { buildTranscribeOnlyAction } from "../../application/use-cases/build-audio-transcription-action.js";

const normalizeMessageType = (value?: string): string => (value ?? "").trim().toLowerCase();
const isAudioMessageType = (value: string): boolean => value === "audiomessage";

export interface AudioCommandDeps {
  config: AudioModuleConfigPort;
  formatUsage?: (command: "transcribe") => string | null;
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

  const inboundType = normalizeMessageType(ctx.event.rawMessageType);
  const quotedType = normalizeMessageType(ctx.event.quotedMessageType);
  const hasQuoted = Boolean(ctx.event.quotedWaMessageId);

  if (isAudioMessageType(inboundType)) {
    return [
      buildTranscribeOnlyAction({
        source: "inbound",
        commandPrefix: deps.config.commandPrefix
      })
    ];
  }

  if (hasQuoted && isAudioMessageType(quotedType)) {
    return [
      buildTranscribeOnlyAction({
        source: "quoted",
        commandPrefix: deps.config.commandPrefix
      })
    ];
  }

  const usage = deps.formatUsage?.("transcribe");
  return replyText(
    deps,
    usage ??
      "Uso correto: transcribe respondendo um áudio. Você também pode enviar áudio direto para transcrição automática."
  );
};
