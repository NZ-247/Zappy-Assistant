import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import { parseTtsCommand } from "../../infrastructure/tts-command-parser.js";
import { synthesizeTts } from "../../application/use-cases/synthesize-tts.js";
import type { TextToSpeechPort, TextTranslationPort, TtsModuleConfigPort } from "../../ports.js";

export interface TtsCommandDeps {
  textToSpeech?: TextToSpeechPort;
  textTranslation?: TextTranslationPort;
  config: TtsModuleConfigPort;
  formatUsage?: (command: "tts") => string | null;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}

const parseFailureMessage = (reason: string, usage?: string | null): string => {
  if (usage) return usage;
  if (reason === "too_many_segments") {
    return "Formato inválido. Use: tts <texto> |<idioma>|<voz> ou tts <texto> |<origem>|<destino>|<voz>.";
  }
  if (reason === "malformed_command") {
    return "Formato inválido. Exemplo: tts Bom dia a todos |pt-BR|en|female";
  }
  return "Uso correto: tts <texto> |<destino>|<voz> ou tts <texto> |<origem>|<destino>|<voz>";
};

export const handleTtsCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: TtsCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, deps } = input;
  if (commandKey !== "tts") return null;

  const parsed = parseTtsCommand(cmd);
  if (!parsed.ok) {
    const usage = deps.formatUsage?.("tts");
    const text = parseFailureMessage(parsed.reason, usage);
    return [{ kind: "reply_text", text: deps.stylizeReply ? deps.stylizeReply(text) : text }];
  }

  return synthesizeTts({
    request: parsed.value,
    textToSpeech: deps.textToSpeech,
    textTranslation: deps.textTranslation,
    config: deps.config,
    stylizeReply: deps.stylizeReply,
    logger: deps.logger
  });
};
