import type { WebSearchPort, WebSearchResultItem } from "@zappy/core";

export interface WebSearchAdapterInput {
  googleApiKey?: string;
  googleCx?: string;
  timeoutMs?: number;
  preferredProvider?: "google" | "duckduckgo";
}

const DEFAULT_TIMEOUT_MS = 10_000;

const STOPWORDS = new Set([
  "a",
  "o",
  "as",
  "os",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "para",
  "por",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for"
]);

const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];

const fetchJson = async <T>(url: string, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "zappy-assistant/1.5 (+web-search)"
      },
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

const fetchText = async (url: string, timeoutMs: number): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; zappy-assistant/1.5; +https://services.net.br)"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => {
      const asNumber = Number(code);
      if (!Number.isFinite(asNumber)) return "";
      try {
        return String.fromCodePoint(asNumber);
      } catch {
        return "";
      }
    });

const stripTags = (value: string): string => decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const normalizeSearchLink = (href: string): string => {
  if (!href) return href;

  let normalized = href.trim();
  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  }

  try {
    const ddg = new URL(normalized, "https://duckduckgo.com");
    const maybeUddg = ddg.searchParams.get("uddg");
    if (maybeUddg) {
      normalized = decodeURIComponent(maybeUddg);
    }
  } catch {
    // Mantém href original.
  }

  try {
    const url = new URL(normalized);
    url.hash = "";
    for (const key of TRACKING_PARAMS) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return normalized;
  }
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

const countTokenMatches = (tokens: string[], text: string): number => {
  if (!tokens.length || !text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) score += 1;
  }
  return score;
};

const rankAndFilterWebResults = (input: { query: string; items: WebSearchResultItem[]; limit: number }): WebSearchResultItem[] => {
  const query = input.query.trim().toLowerCase();
  const tokens = tokenize(query);
  const seenLinks = new Set<string>();

  const scored = input.items
    .map((item) => {
      const title = item.title.trim();
      const snippet = item.snippet?.trim() || "";
      const link = normalizeSearchLink(item.link);

      if (!title || !link) return null;

      const linkKey = link.toLowerCase();
      if (seenLinks.has(linkKey)) return null;
      seenLinks.add(linkKey);

      const titleMatches = countTokenMatches(tokens, title);
      const snippetMatches = countTokenMatches(tokens, snippet);
      const linkMatches = countTokenMatches(tokens, link);
      const fullQueryHit = query.length >= 4 && (title.toLowerCase().includes(query) || snippet.toLowerCase().includes(query));

      let score = 0;
      score += fullQueryHit ? 8 : 0;
      score += titleMatches * 3;
      score += snippetMatches * 1.8;
      score += linkMatches * 1.2;
      if (snippet.length < 30) score -= 1.5;
      if (title.length < 8) score -= 1;

      return {
        item: {
          title,
          snippet: snippet || undefined,
          link
        } as WebSearchResultItem,
        score,
        relevance: titleMatches + snippetMatches + linkMatches
      };
    })
    .filter((value): value is { item: WebSearchResultItem; score: number; relevance: number } => Boolean(value));

  const filtered = scored.filter((entry) => (tokens.length === 0 ? true : entry.relevance > 0));
  const pool = filtered.length > 0 ? filtered : scored;

  return pool
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((entry) => entry.item);
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
        link: normalizeSearchLink(firstUrl)
      });
    }
  }
};

const parseDuckDuckGoHtml = (html: string): WebSearchResultItem[] => {
  const results: WebSearchResultItem[] = [];
  const anchorPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const href = normalizeSearchLink(match[1] || "");
    const title = stripTags(match[2] || "");
    if (!href || !title) continue;

    const sliceStart = match.index;
    const sliceEnd = Math.min(html.length, sliceStart + 1400);
    const block = html.slice(sliceStart, sliceEnd);
    const snippetMatch = block.match(/<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1] || "") : undefined;

    results.push({
      title,
      snippet,
      link: href
    });
  }

  return results;
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

  const mapped = items
    .filter((item) => item && item.title && item.link)
    .map((item) => ({
      title: String(item.title),
      snippet: typeof item.snippet === "string" ? item.snippet : undefined,
      link: normalizeSearchLink(String(item.link))
    }));

  return rankAndFilterWebResults({ query: input.query, items: mapped, limit: input.limit });
};

const duckDuckGoSearch = async (input: {
  query: string;
  limit: number;
  timeoutMs: number;
}): Promise<WebSearchResultItem[]> => {
  const htmlUrl = new URL("https://html.duckduckgo.com/html/");
  htmlUrl.searchParams.set("q", input.query);
  htmlUrl.searchParams.set("kl", "wt-wt");

  const html = await fetchText(htmlUrl.toString(), input.timeoutMs);
  const htmlParsed = parseDuckDuckGoHtml(html);
  const rankedHtml = rankAndFilterWebResults({ query: input.query, items: htmlParsed, limit: input.limit });
  if (rankedHtml.length > 0) {
    return rankedHtml;
  }

  const instantUrl = new URL("https://api.duckduckgo.com/");
  instantUrl.searchParams.set("q", input.query);
  instantUrl.searchParams.set("format", "json");
  instantUrl.searchParams.set("no_html", "1");
  instantUrl.searchParams.set("no_redirect", "1");
  instantUrl.searchParams.set("skip_disambig", "1");

  const payload = await fetchJson<{
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: any[];
  }>(instantUrl.toString(), input.timeoutMs);

  const fallback: WebSearchResultItem[] = [];
  if (payload.AbstractText && payload.AbstractURL) {
    fallback.push({
      title: payload.Heading || "Resultado",
      snippet: payload.AbstractText,
      link: normalizeSearchLink(payload.AbstractURL)
    });
  }

  if (Array.isArray(payload.RelatedTopics)) {
    pickDuckDuckGoTopics(payload.RelatedTopics, fallback);
  }

  return rankAndFilterWebResults({ query: input.query, items: fallback, limit: input.limit });
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
