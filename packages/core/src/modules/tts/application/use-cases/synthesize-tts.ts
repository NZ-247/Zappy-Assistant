import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { TextToSpeechPort } from "../../ports.js";
import {
  isValidLanguageTag,
  isValidVoiceToken,
  normalizeLanguageTag,
  resolveVoiceAlias,
  type TtsCommandInput
} from "../../domain/tts-request.js";

export interface TtsUseCaseConfig {
  enabled: boolean;
  defaultLanguage: string;
  defaultVoice: string;
  maxTextChars: number;
  voiceAliases?: Record<string, string>;
}

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const sanitizeErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "erro desconhecido";
  const message = error.message.trim();
  if (!message) return "erro desconhecido";
  return message.length <= 160 ? message : `${message.slice(0, 157)}...`;
};

export const synthesizeTts = async (input: {
  request: TtsCommandInput;
  textToSpeech?: TextToSpeechPort;
  config: TtsUseCaseConfig;
  stylizeReply?: (text: string) => string;
}): Promise<ResponseAction[]> => {
  const replyText = (text: string): ResponseAction[] => [{ kind: "reply_text", text: input.stylizeReply ? input.stylizeReply(text) : text }];

  if (!input.config.enabled) {
    return replyText("Módulo TTS está desativado neste ambiente.");
  }

  if (!input.textToSpeech) {
    return replyText("Módulo TTS não está configurado no runtime atual.");
  }

  const text = normalizeText(input.request.text);
  if (!text) return replyText("Informe um texto para converter em áudio.");
  if (text.length > input.config.maxTextChars) {
    return replyText(`Texto muito longo para TTS. Limite atual: ${input.config.maxTextChars} caracteres.`);
  }

  const resolvedLanguage = normalizeLanguageTag(input.request.language ?? input.config.defaultLanguage);
  if (!isValidLanguageTag(resolvedLanguage)) {
    return replyText("Idioma inválido. Use formato como pt-BR, pt ou en.");
  }

  const voiceBase = input.request.voice ?? input.config.defaultVoice;
  const resolvedVoice = resolveVoiceAlias({
    voice: voiceBase,
    aliases: input.config.voiceAliases
  });

  if (!isValidVoiceToken(resolvedVoice)) {
    return replyText("Voz inválida. Use tokens como male, female ou um identificador de voz válido.");
  }

  try {
    const synthesized = await input.textToSpeech.synthesize({
      text,
      language: resolvedLanguage,
      voice: resolvedVoice
    });

    if (!synthesized.audioBase64 || !synthesized.mimeType) {
      return replyText("Falha ao gerar áudio TTS: resposta vazia do provider.");
    }

    return [
      {
        kind: "reply_audio",
        audioBase64: synthesized.audioBase64,
        mimeType: synthesized.mimeType,
        caption: `TTS (${resolvedLanguage}, ${resolvedVoice})`
      }
    ];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return replyText(`Falha ao gerar áudio TTS: ${message}.`);
  }
};
