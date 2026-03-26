import { normalizeSearchAiQuery } from "../domain/search-ai-query.js";
import { resolveTextInputFromExplicitOrReply, type ReplyContextInput, type ReplyInputSource } from "../../../common/reply-context-input.js";

export type SearchAiCommandKey = "search-ai" | "sai";

export const parseSearchAiCommand = (
  commandBody: string,
  input?: { replyContext?: ReplyContextInput }
): { ok: true; query: string; source: ReplyInputSource } | { ok: false; reason: "missing_query" | "incompatible_reply" } => {
  const raw = commandBody.replace(/^(search-ai|sai)\b/i, "");
  const resolved = resolveTextInputFromExplicitOrReply({
    explicitText: normalizeSearchAiQuery(raw),
    replyContext: input?.replyContext
  });

  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason === "incompatible_reply" ? "incompatible_reply" : "missing_query" };
  }

  return { ok: true, query: normalizeSearchAiQuery(resolved.text), source: resolved.source };
};
