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

  for (const candidate of candidates.slice(0, 1)) {
    const chunks = Array.isArray(candidate?.groundingMetadata?.groundingChunks) ? candidate.groundingMetadata.groundingChunks : [];
    for (const chunk of chunks) {
      const web = chunk?.web;
      const url = typeof web?.uri === "string" ? web.uri.trim() : "";
      if (seen.has(url)) continue;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) continue;
      } catch { continue; }
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
              text: "Você é um assistente de pesquisa web. Responda em português do Brasil e resuma com objetividade. Use as fontes da busca. Mantenha URLs fora da síntese."
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

      const signal = AbortSignal.timeout(timeoutMs);
      let data: unknown;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          redirect: "error",
          signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`gemini_http_${response.status}`);
        }
        data = await response.json();
      } catch (error) {
        if (signal.aborted) throw new Error("gemini_timeout");
        if (error instanceof Error && /^gemini_http_\d{3}$/.test(error.message)) throw error;
        throw new Error("gemini_unavailable");
      }
      const sources = extractSources(data).slice(0, maxSources);
      if (!useGoogleSearchGrounding || !sources.length) throw new Error("gemini_no_grounding");
      const summary = extractSummary(data).replace(/https?:\/\/[^\s)>]+/gi, "").trim();
      if (!summary) throw new Error("gemini_no_grounding");

      return {
        provider: useGoogleSearchGrounding ? "gemini_google_search" : "gemini",
        model,
        summary,
        sources
      };
    }
  };
};
