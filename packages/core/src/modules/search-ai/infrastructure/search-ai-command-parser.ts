import { normalizeSearchAiQuery } from "../domain/search-ai-query.js";

export type SearchAiCommandKey = "search-ai" | "sai";

export const parseSearchAiCommand = (commandBody: string): { ok: true; query: string } | { ok: false; reason: "missing_query" } => {
  const raw = commandBody.replace(/^(search-ai|sai)\b/i, "");
  const query = normalizeSearchAiQuery(raw);
  if (!query) return { ok: false, reason: "missing_query" };
  return { ok: true, query };
};
