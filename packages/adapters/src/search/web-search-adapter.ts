import type { WebSearchPort, WebSearchResultItem } from "@zappy/core";

export interface WebSearchAdapterInput {
  googleApiKey?: string;
  googleCx?: string;
  timeoutMs?: number;
  preferredProvider?: "google" | "duckduckgo";
}

const DEFAULT_TIMEOUT_MS = 10_000;

const fetchJson = async <T>(url: string, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

const pickDuckDuckGoTopics = (items: any[], output: WebSearchResultItem[]) => {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.Topics && Array.isArray(item.Topics)) {
      pickDuckDuckGoTopics(item.Topics, output);
      continue;
    }
    const text = typeof item.Text === "string" ? item.Text : "";
    const firstUrl = typeof item.FirstURL === "string" ? item.FirstURL : "";
    if (text && firstUrl) {
      const [title, ...rest] = text.split(" - ");
      output.push({
        title: title?.trim() || text,
        snippet: rest.join(" - ").trim() || text,
        link: firstUrl
      });
    }
  }
};

const googleSearch = async (input: {
  apiKey: string;
  cx: string;
  query: string;
  limit: number;
  timeoutMs: number;
}): Promise<WebSearchResultItem[]> => {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", input.apiKey);
  url.searchParams.set("cx", input.cx);
  url.searchParams.set("q", input.query);
  url.searchParams.set("num", String(Math.min(10, Math.max(1, input.limit))));

  const payload = await fetchJson<{ items?: Array<{ title?: string; snippet?: string; link?: string }> }>(url.toString(), input.timeoutMs);
  const items = payload.items ?? [];
  return items
    .filter((item) => item && item.title && item.link)
    .map((item) => ({
      title: String(item.title),
      snippet: typeof item.snippet === "string" ? item.snippet : undefined,
      link: String(item.link)
    }));
};

const duckDuckGoSearch = async (input: {
  query: string;
  limit: number;
  timeoutMs: number;
}): Promise<WebSearchResultItem[]> => {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("skip_disambig", "1");

  const payload = await fetchJson<{
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: any[];
  }>(url.toString(), input.timeoutMs);

  const results: WebSearchResultItem[] = [];
  if (payload.AbstractText && payload.AbstractURL) {
    results.push({
      title: payload.Heading || "Resultado",
      snippet: payload.AbstractText,
      link: payload.AbstractURL
    });
  }

  if (Array.isArray(payload.RelatedTopics)) {
    pickDuckDuckGoTopics(payload.RelatedTopics, results);
  }

  return results.slice(0, input.limit);
};

export const createWebSearchAdapter = (input: WebSearchAdapterInput): WebSearchPort => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    search: async ({ query, limit }) => {
      const preferred = input.preferredProvider ?? "google";
      const hasGoogleConfig = Boolean(input.googleApiKey && input.googleCx);

      const runGoogle = async () => {
        if (!hasGoogleConfig) return [];
        return googleSearch({
          apiKey: input.googleApiKey!,
          cx: input.googleCx!,
          query,
          limit,
          timeoutMs
        });
      };

      if (preferred === "google") {
        try {
          const googleResults = await runGoogle();
          if (googleResults.length > 0) {
            return { provider: "google_cse", results: googleResults.slice(0, limit) };
          }
        } catch {
          // Fallback para DDG abaixo.
        }
      }

      const ddgResults = await duckDuckGoSearch({ query, limit, timeoutMs });
      if (ddgResults.length > 0) {
        return { provider: "duckduckgo", results: ddgResults };
      }

      if (preferred !== "google") {
        try {
          const googleResults = await runGoogle();
          if (googleResults.length > 0) {
            return { provider: "google_cse", results: googleResults.slice(0, limit) };
          }
        } catch {
          // Mantém sem resultados.
        }
      }

      return { provider: hasGoogleConfig ? "google_cse+duckduckgo" : "duckduckgo", results: [] };
    }
  };
};
