import { normalizeWebQuery } from "../domain/web-search-query.js";

export type WebSearchCommandKey = "search" | "google";

export const parseWebSearchCommand = (commandBody: string): { ok: true; query: string } | { ok: false; reason: "missing_query" } => {
  const raw = commandBody.replace(/^(search|google)\b/i, "");
  const query = normalizeWebQuery(raw);
  if (!query) return { ok: false, reason: "missing_query" };
  return { ok: true, query };
};
