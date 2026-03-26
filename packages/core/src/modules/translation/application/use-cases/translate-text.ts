import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import type { TextTranslationPort } from "../../ports.js";
import type { TranslationCommandInput } from "../../domain/translation-request.js";
import {
  inferSourceLanguageFallback,
  isPortugueseLanguage,
  isValidLanguageTag,
  normalizeLanguageTag,
  normalizeMode,
  normalizeTranslationText
} from "../../domain/translation-request.js";

export interface TranslationUseCaseConfig {
  enabled: boolean;
  maxTextChars: number;
  defaultTargetForPortuguese: string;
  defaultTargetForOther: string;
}

const shorten = (value: string, max = 120): string => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);

const sanitizeErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "erro desconhecido";
  const message = normalizeTranslationText(error.message);
  if (!message) return "erro desconhecido";
  return message.length <= 160 ? message : `${message.slice(0, 157)}...`;
};

const logTranslation = (
  logger: LoggerPort | undefined,
  payload: {
    action: "detect" | "translate";
    status: "success" | "failure";
    text: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    mode?: "basic" | "full";
    provider?: string;
    model?: string;
    reason?: string;
  }
): void => {
  logger?.info?.(
    {
      capability: "translation",
      action: payload.action,
      status: payload.status,
      textPreview: shorten(payload.text),
      sourceLanguage: payload.sourceLanguage,
      targetLanguage: payload.targetLanguage,
      mode: payload.mode,
      provider: payload.provider,
      model: payload.model,
      reason: payload.reason
    },
    "translation capability"
  );
};

const detectSourceLanguage = async (input: {
  text: string;
  textTranslation: TextTranslationPort;
  logger?: LoggerPort;
}): Promise<string | undefined> => {
  if (!input.textTranslation.detectLanguage) {
    const inferred = inferSourceLanguageFallback(input.text);
    return inferred === "unknown" ? undefined : inferred;
  }

  try {
    const detected = await input.textTranslation.detectLanguage({ text: input.text });
    const normalized = normalizeLanguageTag(detected.language);
    if (isValidLanguageTag(normalized)) {
      logTranslation(input.logger, {
        action: "detect",
        status: "success",
        text: input.text,
        sourceLanguage: normalized,
        provider: detected.provider,
        model: detected.model
      });
      return normalized;
    }
  } catch (error) {
    logTranslation(input.logger, {
      action: "detect",
      status: "failure",
      text: input.text,
      reason: sanitizeErrorMessage(error)
    });
  }

  const fallback = inferSourceLanguageFallback(input.text);
  return fallback === "unknown" ? undefined : fallback;
};

export const executeTranslation = async (input: {
  request: TranslationCommandInput;
  textTranslation?: TextTranslationPort;
  config: TranslationUseCaseConfig;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}): Promise<ResponseAction[]> => {
  const replyText = (text: string): ResponseAction[] => [{ kind: "reply_text", text: input.stylizeReply ? input.stylizeReply(text) : text }];

  if (!input.config.enabled) {
    return replyText("Traducao esta desativada neste ambiente.");
  }

  if (!input.textTranslation) {
    return replyText("Traducao nao esta configurada no runtime atual.");
  }

  const text = normalizeTranslationText(input.request.text);
  if (!text) return replyText("Informe um texto para traducao.");

  if (text.length > input.config.maxTextChars) {
    return replyText(`Texto muito longo para traducao. Limite atual: ${input.config.maxTextChars} caracteres.`);
  }

  const mode = normalizeMode(input.request.mode);

  const explicitTarget = input.request.targetLanguage ? normalizeLanguageTag(input.request.targetLanguage) : undefined;
  if (explicitTarget && !isValidLanguageTag(explicitTarget)) {
    return replyText("Idioma de destino invalido. Use formato como en, pt, es ou zh-cn.");
  }

  const detectedSource = explicitTarget
    ? undefined
    : await detectSourceLanguage({
        text,
        textTranslation: input.textTranslation,
        logger: input.logger
      });

  const targetLanguage = explicitTarget
    ? explicitTarget
    : isPortugueseLanguage(detectedSource)
      ? normalizeLanguageTag(input.config.defaultTargetForPortuguese)
      : normalizeLanguageTag(input.config.defaultTargetForOther);

  if (!isValidLanguageTag(targetLanguage)) {
    return replyText("Configuracao de idioma de destino invalida no runtime atual.");
  }

  try {
    const translated = await input.textTranslation.translate({
      text,
      sourceLanguage: detectedSource,
      targetLanguage,
      mode
    });

    const translatedText = normalizeTranslationText(translated.translatedText);
    if (!translatedText) {
      throw new Error("translation_empty_output");
    }

    const detectedOutput = translated.detectedSourceLanguage ? normalizeLanguageTag(translated.detectedSourceLanguage) : detectedSource;

    logTranslation(input.logger, {
      action: "translate",
      status: "success",
      text,
      sourceLanguage: detectedOutput,
      targetLanguage,
      mode,
      provider: translated.provider,
      model: translated.model
    });

    if (mode === "full") {
      const pronunciation = normalizeTranslationText(translated.transliteration ?? translated.pronunciation ?? "");
      const lines = [`Escrita: ${translatedText}`];
      if (pronunciation) {
        lines.push(`Pronuncia: ${pronunciation}`);
      }
      return replyText(lines.join("\n"));
    }

    return replyText(translatedText);
  } catch (error) {
    const reason = sanitizeErrorMessage(error);
    logTranslation(input.logger, {
      action: "translate",
      status: "failure",
      text,
      sourceLanguage: detectedSource,
      targetLanguage,
      mode,
      reason
    });
    return replyText(`Falha na traducao: ${reason}.`);
  }
};
