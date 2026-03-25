import { normalizeImageQuery } from "../domain/image-search-query.js";

export type ImageSearchCommandKey = "img" | "gimage";

export const parseImageSearchCommand = (commandBody: string): { ok: true; query: string } | { ok: false; reason: "missing_query" } => {
  const raw = commandBody.replace(/^(img|gimage)\b/i, "");
  const query = normalizeImageQuery(raw);
  if (!query) return { ok: false, reason: "missing_query" };
  return { ok: true, query };
};
