import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import { parseTranslationCommand } from "../../infrastructure/translation-command-parser.js";
import { executeTranslation, type TranslationUseCaseConfig } from "../../application/use-cases/translate-text.js";
import type { TextTranslationPort } from "../../ports.js";

export interface TranslationCommandDeps {
  textTranslation?: TextTranslationPort;
  config: TranslationUseCaseConfig;
  commandPrefix?: string;
  formatUsage?: (command: "trl") => string | null;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}

const resolveCommandPrefix = (value?: string): string => {
  const normalized = (value ?? "").trim();
  return normalized || "/";
};

const parseFailureMessage = (reason: string, usage?: string | null): string => {
  if (reason === "incompatible_reply") {
    if (usage) return `Esse comando usa texto ou áudio respondido. Responda texto/áudio ou informe o texto.\n${usage}`;
    return "Esse comando usa texto ou áudio respondido. Responda texto/áudio ou informe o texto.";
  }
  if (usage) return usage;
  if (reason === "too_many_segments") {
    return "Formato invalido. Use: trl <texto> |<destino>";
  }
  if (reason === "malformed_command") {
    return "Formato invalido. Exemplo: trl Ola |en";
  }
  return "Uso correto: trl <texto> |<destino> ou trl |<destino> (respondendo texto/áudio)";
};

export const handleTranslationCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: TranslationCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps } = input;
  if (commandKey !== "trl") return null;

  const parsed = parseTranslationCommand(cmd, {
    replyContext: {
      quotedWaMessageId: ctx.event.quotedWaMessageId,
      quotedMessageType: ctx.event.quotedMessageType,
      quotedText: ctx.event.quotedText,
      quotedHasMedia: ctx.event.quotedHasMedia
    }
  });

  if (!parsed.ok) {
    const usage = deps.formatUsage?.("trl");
    const text = parseFailureMessage(parsed.reason, usage);
    return [{ kind: "reply_text", text: deps.stylizeReply ? deps.stylizeReply(text) : text }];
  }

  if (parsed.value.kind === "audio_reply") {
    const prefix = resolveCommandPrefix(deps.commandPrefix);
    const targetSegment = parsed.value.targetLanguage ? ` |${parsed.value.targetLanguage}` : "";
    const dispatchTemplate = `${prefix}trl {{transcript}}${targetSegment}`;
    return [
      {
        kind: "audio_transcription",
        source: "quoted",
        mode: "transcribe_and_route",
        allowCommandDispatch: false,
        commandPrefix: prefix,
        origin: "command",
        dispatchTemplate
      }
    ];
  }

  return executeTranslation({
    request: parsed.value.request,
    textTranslation: deps.textTranslation,
    config: deps.config,
    transcriptionText: ctx.event.ingressSource === "audio_stt" ? ctx.event.sttTranscript : undefined,
    stylizeReply: deps.stylizeReply,
    logger: deps.logger
  });
};
