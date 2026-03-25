import type { SearchAiPort, SearchAiSourceItem } from "@zappy/core";

export interface GeminiSearchAiAdapterInput {
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  maxSources?: number;
  useGoogleSearchGrounding?: boolean;
  apiBaseUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 22_000;
const DEFAULT_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const compactText = (value: string): string => value.replace(/\s+/g, " ").trim();

const clampSources = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return 4;
  return Math.min(8, Math.max(1, Math.trunc(value as number)));
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("search_ai_request_timeout")), timeoutMs);
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

const extractSummary = (response: any): string => {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  const chunks = parts
    .map((part) => (typeof part?.text === "string" ? compactText(part.text) : ""))
    .filter(Boolean);
  return compactText(chunks.join(" "));
};

const extractSources = (response: any): SearchAiSourceItem[] => {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const seen = new Set<string>();
  const sources: SearchAiSourceItem[] = [];

  for (const candidate of candidates) {
    const chunks = Array.isArray(candidate?.groundingMetadata?.groundingChunks) ? candidate.groundingMetadata.groundingChunks : [];
    for (const chunk of chunks) {
      const web = chunk?.web;
      const url = typeof web?.uri === "string" ? web.uri.trim() : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const title = typeof web?.title === "string" && web.title.trim() ? web.title.trim() : url;
      sources.push({ title, url });
    }
  }

  return sources;
};

export const createGeminiSearchAiAdapter = (input: GeminiSearchAiAdapterInput): SearchAiPort | undefined => {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) return undefined;

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxSources = clampSources(input.maxSources);
  const model = input.model.trim();
  const useGoogleSearchGrounding = input.useGoogleSearchGrounding ?? true;
  const apiBaseUrl = (input.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");

  return {
    search: async (request: Parameters<SearchAiPort["search"]>[0]) => {
      const maxSources = clampSources(request.maxSources ?? defaultMaxSources);
      const endpoint = `${apiBaseUrl}/models/${encodeURIComponent(model)}:generateContent`;
      const payload = {
        systemInstruction: {
          parts: [
            {
              text: "Você é um assistente de pesquisa web. Resuma com objetividade, priorize fatos recentes e evite especulações."
            }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: request.query }]
          }
        ],
        tools: useGoogleSearchGrounding ? [{ google_search: {} }] : undefined
      };

      const response = await withTimeout(
        fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(payload)
        }),
        timeoutMs
      );

      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        const message = compactText(raw) || `http_${response.status}`;
        throw new Error(`gemini_search_failed:${message}`);
      }

      const data = (await response.json()) as any;
      const summary = extractSummary(data);
      if (!summary) {
        throw new Error("search_ai_empty_response");
      }

      return {
        provider: useGoogleSearchGrounding ? "gemini_google_search" : "gemini",
        model,
        summary,
        sources: extractSources(data).slice(0, maxSources)
      };
    }
  };
};
