import OpenAI from "openai";
import type { SearchAiPort, SearchAiSourceItem } from "@zappy/core";

export interface OpenAiSearchAiAdapterInput {
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  maxSources?: number;
}

const DEFAULT_TIMEOUT_MS = 22_000;

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

const compactText = (value: string): string => value.replace(/\s+/g, " ").trim();

const extractSummary = (response: any): string => {
  const outputText = typeof response?.output_text === "string" ? compactText(response.output_text) : "";
  if (outputText) return outputText;

  const outputs = Array.isArray(response?.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of outputs) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        const text = compactText(content.text);
        if (text) chunks.push(text);
      }
    }
  }

  return compactText(chunks.join(" "));
};

const extractSources = (response: any): SearchAiSourceItem[] => {
  const outputs = Array.isArray(response?.output) ? response.output : [];
  const seen = new Set<string>();
  const sources: SearchAiSourceItem[] = [];

  for (const item of outputs) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type !== "output_text" || !Array.isArray(content.annotations)) continue;
      for (const annotation of content.annotations) {
        if (annotation?.type !== "url_citation") continue;
        const url = typeof annotation.url === "string" ? annotation.url.trim() : "";
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const title = typeof annotation.title === "string" && annotation.title.trim() ? annotation.title.trim() : url;
        sources.push({ title, url });
      }
    }
  }

  return sources;
};

const clampSources = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return 4;
  return Math.min(8, Math.max(1, Math.trunc(value as number)));
};

export const createOpenAiSearchAiAdapter = (input: OpenAiSearchAiAdapterInput): SearchAiPort | undefined => {
  const client = input.apiKey ? new OpenAI({ apiKey: input.apiKey }) : null;
  if (!client) return undefined;

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxSources = clampSources(input.maxSources);

  return {
    search: async (request: Parameters<SearchAiPort["search"]>[0]) => {
      const model = input.model;
      const maxSources = clampSources(request.maxSources ?? defaultMaxSources);

      const response = await withTimeout(
        (client as any).responses.create({
          model,
          tools: [{ type: "web_search_preview" }],
          input: [
            {
              role: "system",
              content:
                "You are a web research assistant. Use web search to answer the query with concise, factual synthesis. Prioritize recency when relevant and avoid speculation."
            },
            {
              role: "user",
              content: request.query
            }
          ]
        }),
        timeoutMs
      );

      const summary = extractSummary(response);
      if (!summary) {
        throw new Error("search_ai_empty_response");
      }

      return {
        provider: "openai_web_search",
        model,
        summary,
        sources: extractSources(response).slice(0, maxSources)
      };
    }
  };
};
