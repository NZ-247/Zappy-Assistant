import OpenAI from "openai";
import type { TextToSpeechPort } from "@zappy/core";

export interface OpenAiTextToSpeechAdapterInput {
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  format?: "mp3" | "wav" | "opus";
  voices?: {
    male?: string;
    female?: string;
    default?: string;
  };
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tts_request_timeout")), timeoutMs);
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

const normalizeVoice = (input: {
  requested: string;
  defaults: Required<NonNullable<OpenAiTextToSpeechAdapterInput["voices"]>>;
}): string => {
  const normalized = input.requested.trim().toLowerCase();
  if (!normalized) return input.defaults.default;
  if (normalized === "male") return input.defaults.male;
  if (normalized === "female") return input.defaults.female;
  return normalized;
};

const toBuffer = async (value: unknown): Promise<Buffer> => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function") {
    const asResponse = value as { arrayBuffer: () => Promise<ArrayBuffer> };
    return Buffer.from(await asResponse.arrayBuffer());
  }
  const data = (value as { data?: unknown } | undefined)?.data;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  throw new Error("tts_empty_audio_payload");
};

const mimeByFormat = (format: "mp3" | "wav" | "opus"): string => {
  if (format === "wav") return "audio/wav";
  if (format === "opus") return "audio/ogg; codecs=opus";
  return "audio/mpeg";
};

export const createOpenAiTextToSpeechAdapter = (input: OpenAiTextToSpeechAdapterInput): TextToSpeechPort | undefined => {
  const client = input.apiKey ? new OpenAI({ apiKey: input.apiKey }) : null;
  if (!client) return undefined;

  const format = input.format ?? "mp3";
  const timeoutMs = input.timeoutMs ?? 25_000;
  const defaults = {
    male: input.voices?.male ?? "alloy",
    female: input.voices?.female ?? "nova",
    default: input.voices?.default ?? "nova"
  };

  return {
    synthesize: async (request) => {
      const voice = normalizeVoice({ requested: request.voice, defaults });
      const model = input.model;

      const response = await withTimeout(
        (client as any).audio.speech.create({
          model,
          voice,
          input: request.text,
          format,
          instructions: request.language ? `Speak naturally in ${request.language}.` : undefined
        } as any),
        request.timeoutMs ?? timeoutMs
      );

      const audioBuffer = await toBuffer(response);
      if (!audioBuffer.length) throw new Error("tts_empty_audio_payload");

      return {
        audioBase64: audioBuffer.toString("base64"),
        mimeType: mimeByFormat(format),
        provider: "openai",
        model,
        voice,
        language: request.language
      };
    }
  };
};
