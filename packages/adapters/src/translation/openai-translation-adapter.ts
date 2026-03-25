import OpenAI from "openai";
import type { TextTranslationPort } from "@zappy/core";

export interface OpenAiTranslationAdapterInput {
  apiKey?: string;
  model: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

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

export const createOpenAiTranslationAdapter = (input: OpenAiTranslationAdapterInput): TextTranslationPort | undefined => {
  const client = input.apiKey ? new OpenAI({ apiKey: input.apiKey }) : null;
  if (!client) return undefined;

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    translate: async (request: Parameters<TextTranslationPort["translate"]>[0]) => {
      const sourceLanguage = request.sourceLanguage?.trim() || "auto";
      const targetLanguage = request.targetLanguage.trim();
      const model = input.model;

      const response = await withTimeout(
        (client as any).responses.create({
          model,
          input: [
            {
              role: "system",
              content:
                "You are a precise translation engine. Translate the user text preserving meaning and tone. Return only the translated text, without quotes or extra notes."
            },
            {
              role: "user",
              content: `Source language: ${sourceLanguage}\nTarget language: ${targetLanguage}\nText:\n${request.text}`
            }
          ]
        }),
        request.timeoutMs ?? timeoutMs
      );

      const translatedText = extractOutputText(response);
      if (!translatedText) {
        throw new Error("translation_empty_output");
      }

      return {
        translatedText,
        provider: "openai",
        model,
        sourceLanguage: sourceLanguage === "auto" ? undefined : sourceLanguage,
        targetLanguage
      };
    }
  };
};
