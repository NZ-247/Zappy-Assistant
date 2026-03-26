import OpenAI from "openai";
import type { TextTranslationPort } from "@zappy/core";

export interface OpenAiTranslationAdapterInput {
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  client?: {
    responses: {
      create: (input: unknown) => Promise<unknown>;
    };
  };
}

const DEFAULT_TIMEOUT_MS = 20_000;
const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("translation_request_timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

const extractOutputText = (response: any): string => {
  const outputText = typeof response?.output_text === "string" ? response.output_text.trim() : "";
  if (outputText) return outputText;

  const outputs = Array.isArray(response?.output) ? response.output : [];
  for (const item of outputs) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        const text = content.text.trim();
        if (text) return text;
      }
    }
  }

  return "";
};

const normalizeLanguageTag = (value?: string | null): string | undefined => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  return LANGUAGE_TAG_PATTERN.test(normalized) ? normalized : undefined;
};

const parseJsonObject = (value: string): Record<string, unknown> | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
};

const readTextField = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
};

const parseTranslationPayload = (raw: string): {
  translatedText: string;
  detectedSourceLanguage?: string;
  transliteration?: string;
  pronunciation?: string;
} => {
  const asJson = parseJsonObject(raw);

  if (!asJson) {
    const translatedText = raw.trim();
    if (!translatedText) throw new Error("translation_empty_output");
    return { translatedText };
  }

  const translatedText = readTextField(asJson.translatedText ?? asJson.translation);
  if (!translatedText) throw new Error("translation_empty_output");

  return {
    translatedText,
    detectedSourceLanguage: normalizeLanguageTag(readTextField(asJson.detectedSourceLanguage ?? asJson.sourceLanguage)),
    transliteration: readTextField(asJson.transliteration),
    pronunciation: readTextField(asJson.pronunciation)
  };
};

export const createOpenAiTranslationAdapter = (input: OpenAiTranslationAdapterInput): TextTranslationPort | undefined => {
  const client = input.client ?? (input.apiKey ? new OpenAI({ apiKey: input.apiKey }) : null);
  if (!client) return undefined;

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    detectLanguage: async (request) => {
      const model = input.model;
      const response = await withTimeout(
        (client as any).responses.create({
          model,
          input: [
            {
              role: "system",
              content:
                "You detect the dominant source language. Respond with only one lowercase BCP-47 language tag like pt, pt-br, en, es, fr, de, zh-cn, ja. No extra text."
            },
            {
              role: "user",
              content: request.text
            }
          ]
        }),
        request.timeoutMs ?? timeoutMs
      );

      const output = extractOutputText(response);
      const language = normalizeLanguageTag(output) ?? "und";

      return {
        language,
        provider: "openai",
        model
      };
    },

    translate: async (request) => {
      const sourceLanguage = normalizeLanguageTag(request.sourceLanguage) ?? "auto";
      const targetLanguage = normalizeLanguageTag(request.targetLanguage) ?? request.targetLanguage.trim().toLowerCase();
      const model = input.model;
      const mode = request.mode === "full" ? "full" : "basic";

      const response = await withTimeout(
        (client as any).responses.create({
          model,
          input: [
            {
              role: "system",
              content:
                "You are a precise translation engine. Return strict JSON only with keys translatedText, detectedSourceLanguage, transliteration, pronunciation. translatedText is required; other keys can be empty strings when unavailable. No markdown, no commentary."
            },
            {
              role: "user",
              content:
                `Mode: ${mode}\n` +
                `Source language hint: ${sourceLanguage}\n` +
                `Target language: ${targetLanguage}\n` +
                "Text:\n" +
                request.text
            }
          ]
        }),
        request.timeoutMs ?? timeoutMs
      );

      const raw = extractOutputText(response);
      const parsed = parseTranslationPayload(raw);

      return {
        translatedText: parsed.translatedText,
        provider: "openai",
        model,
        sourceLanguage: sourceLanguage === "auto" ? undefined : sourceLanguage,
        detectedSourceLanguage: parsed.detectedSourceLanguage,
        targetLanguage,
        transliteration: mode === "full" ? parsed.transliteration : undefined,
        pronunciation: mode === "full" ? parsed.pronunciation : undefined
      };
    }
  };
};
