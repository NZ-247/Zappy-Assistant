import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import type { TextToSpeechPort, TextTranslationPort } from "../../ports.js";
import {
  areLanguagesEquivalent,
  isValidLanguageTag,
  isValidVoiceToken,
  normalizeLanguageTag,
  resolveVoiceAlias,
  type TtsCommandInput
} from "../../domain/tts-request.js";

export interface TtsUseCaseConfig {
  enabled: boolean;
  defaultSourceLanguage: string;
  defaultLanguage: string;
  defaultVoice: string;
  maxTextChars: number;
  sendAsPtt?: boolean;
  voiceAliases?: Record<string, string>;
}

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const shorten = (value: string, max = 120): string => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);

const sanitizeErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "erro desconhecido";
  const message = normalizeText(error.message);
  if (!message) return "erro desconhecido";
  return message.length <= 160 ? message : `${message.slice(0, 157)}...`;
};

const logTts = (
  logger: LoggerPort | undefined,
  payload: {
    action: "translate" | "synthesize";
    status: "success" | "failure";
    originalText: string;
    translated: boolean;
    sourceLanguage: string;
    targetLanguage: string;
    voice: string;
    ptt: boolean;
    provider?: string;
    model?: string;
    reason?: string;
  }
): void => {
  logger?.info?.(
    {
      capability: "tts",
      action: payload.action,
      status: payload.status,
      originalTextPreview: shorten(payload.originalText),
      translated: payload.translated,
      sourceLanguage: payload.sourceLanguage,
      targetLanguage: payload.targetLanguage,
      voice: payload.voice,
      ptt: payload.ptt,
      provider: payload.provider,
      model: payload.model,
      reason: payload.reason
    },
    "tts capability"
  );
};

export const synthesizeTts = async (input: {
  request: TtsCommandInput;
  textToSpeech?: TextToSpeechPort;
  textTranslation?: TextTranslationPort;
  config: TtsUseCaseConfig;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}): Promise<ResponseAction[]> => {
  const replyText = (text: string): ResponseAction[] => [{ kind: "reply_text", text: input.stylizeReply ? input.stylizeReply(text) : text }];

  if (!input.config.enabled) {
    return replyText("Módulo TTS está desativado neste ambiente.");
  }

  if (!input.textToSpeech) {
    return replyText("Módulo TTS não está configurado no runtime atual.");
  }

  const originalText = normalizeText(input.request.text);
  if (!originalText) return replyText("Informe um texto para converter em áudio.");
  if (originalText.length > input.config.maxTextChars) {
    return replyText(`Texto muito longo para TTS. Limite atual: ${input.config.maxTextChars} caracteres.`);
  }

  const sourceLanguage = normalizeLanguageTag(input.request.sourceLanguage ?? input.config.defaultSourceLanguage);
  if (!isValidLanguageTag(sourceLanguage)) {
    return replyText("Idioma de origem inválido. Use formato como pt-BR, pt ou en.");
  }

  const targetLanguage = normalizeLanguageTag(input.request.targetLanguage ?? input.request.language ?? input.config.defaultLanguage);
  if (!isValidLanguageTag(targetLanguage)) {
    return replyText("Idioma de destino inválido. Use formato como pt-BR, pt ou en.");
  }

  const voiceBase = input.request.voice ?? input.config.defaultVoice;
  const resolvedVoice = resolveVoiceAlias({
    voice: voiceBase,
    aliases: input.config.voiceAliases
  });

  if (!isValidVoiceToken(resolvedVoice)) {
    return replyText("Voz inválida. Use tokens como male, female ou um identificador de voz válido.");
  }

  const sendAsPtt = input.config.sendAsPtt ?? true;
  const translationRequired = !areLanguagesEquivalent(sourceLanguage, targetLanguage);

  let textForSynthesis = originalText;
  if (translationRequired) {
    if (!input.textTranslation) {
      logTts(input.logger, {
        action: "translate",
        status: "failure",
        originalText,
        translated: true,
        sourceLanguage,
        targetLanguage,
        voice: resolvedVoice,
        ptt: sendAsPtt,
        reason: "translation_provider_missing"
      });
      return replyText("Não consigo traduzir agora para o idioma solicitado. Tente novamente em instantes.");
    }

    try {
      const translated = await input.textTranslation.translate({
        text: originalText,
        sourceLanguage,
        targetLanguage
      });
      textForSynthesis = normalizeText(translated.translatedText);
      if (!textForSynthesis) {
        throw new Error("translation_empty_output");
      }
      logTts(input.logger, {
        action: "translate",
        status: "success",
        originalText,
        translated: true,
        sourceLanguage,
        targetLanguage,
        voice: resolvedVoice,
        ptt: sendAsPtt,
        provider: translated.provider,
        model: translated.model
      });
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      logTts(input.logger, {
        action: "translate",
        status: "failure",
        originalText,
        translated: true,
        sourceLanguage,
        targetLanguage,
        voice: resolvedVoice,
        ptt: sendAsPtt,
        reason: message
      });
      return replyText(`Falha ao traduzir texto antes do TTS: ${message}.`);
    }
  }

  try {
    const synthesized = await input.textToSpeech.synthesize({
      text: textForSynthesis,
      language: targetLanguage,
      voice: resolvedVoice
    });

    if (!synthesized.audioBase64 || !synthesized.mimeType) {
      logTts(input.logger, {
        action: "synthesize",
        status: "failure",
        originalText,
        translated: translationRequired,
        sourceLanguage,
        targetLanguage,
        voice: resolvedVoice,
        ptt: sendAsPtt,
        reason: "tts_empty_audio_payload"
      });
      return replyText("Falha ao gerar áudio TTS: resposta vazia do provider.");
    }

    logTts(input.logger, {
      action: "synthesize",
      status: "success",
      originalText,
      translated: translationRequired,
      sourceLanguage,
      targetLanguage,
      voice: resolvedVoice,
      ptt: sendAsPtt,
      provider: synthesized.provider,
      model: synthesized.model
    });

    const languageLabel = translationRequired ? `${sourceLanguage}->${targetLanguage}` : targetLanguage;

    return [
      {
        kind: "reply_audio",
        audioBase64: synthesized.audioBase64,
        mimeType: synthesized.mimeType,
        caption: `TTS (${languageLabel}, ${resolvedVoice})`,
        ptt: sendAsPtt,
        capability: "tts"
      }
    ];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    logTts(input.logger, {
      action: "synthesize",
      status: "failure",
      originalText,
      translated: translationRequired,
      sourceLanguage,
      targetLanguage,
      voice: resolvedVoice,
      ptt: sendAsPtt,
      reason: message
    });
    return replyText(`Falha ao gerar áudio TTS: ${message}.`);
  }
};
