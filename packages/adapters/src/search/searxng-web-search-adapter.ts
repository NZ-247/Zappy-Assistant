import type { WebSearchPort, WebSearchResultItem } from "@zappy/core";

export function createSearxngWebSearchAdapter(baseUrl: string, request: typeof fetch = fetch): WebSearchPort {
  const endpoint = new URL("search", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  return {
    async search({ query, locale, limit, signal }) {
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ q: query, format: "json", language: locale ?? "pt-BR", categories: "general" }).toString();
      const response = await request(url, {
        headers: { Accept: "application/json" }, redirect: "error",
        signal: signal ?? AbortSignal.timeout(5_000)
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`searxng_http_${response.status}`);
      }
      const payload: { results?: unknown; unresponsive_engines?: unknown } = await response.json();
      if (!Array.isArray(payload?.results)) throw new Error("searxng_invalid_response");
      const results: WebSearchResultItem[] = [];
      for (const item of payload.results) {
        if (typeof item?.title !== "string" || typeof item.url !== "string") continue;
        results.push({ title: item.title, link: item.url, snippet: typeof item.content === "string" ? item.content : undefined });
        if (results.length >= limit) break;
      }
      if (!results.length && Array.isArray(payload.unresponsive_engines) && payload.unresponsive_engines.length > 0) {
        throw new Error("searxng_engines_unavailable");
      }
      return { provider: "searxng", results };
    }
  };
}
