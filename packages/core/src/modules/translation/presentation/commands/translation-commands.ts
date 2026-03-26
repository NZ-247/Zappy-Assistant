import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import { parseTranslationCommand } from "../../infrastructure/translation-command-parser.js";
import { executeTranslation, type TranslationUseCaseConfig } from "../../application/use-cases/translate-text.js";
import type { TextTranslationPort } from "../../ports.js";

export interface TranslationCommandDeps {
  textTranslation?: TextTranslationPort;
  config: TranslationUseCaseConfig;
  formatUsage?: (command: "trl") => string | null;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}

const parseFailureMessage = (reason: string, usage?: string | null): string => {
  if (reason === "incompatible_reply") {
    if (usage) return `Esse comando usa texto. Responda uma mensagem de texto ou informe o texto.\n${usage}`;
    return "Esse comando usa texto. Responda uma mensagem de texto ou informe o texto.";
  }
  if (usage) return usage;
  if (reason === "too_many_segments") {
    return "Formato invalido. Use: trl <texto> |<destino>|full";
  }
  if (reason === "malformed_command") {
    return "Formato invalido. Exemplo: trl Ola |zh-cn|full";
  }
  return "Uso correto: trl <texto> |<destino>|full";
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

  return executeTranslation({
    request: parsed.value,
    textTranslation: deps.textTranslation,
    config: deps.config,
    stylizeReply: deps.stylizeReply,
    logger: deps.logger
  });
};
