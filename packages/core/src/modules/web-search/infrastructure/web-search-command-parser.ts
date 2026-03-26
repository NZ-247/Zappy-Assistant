import { normalizeWebQuery } from "../domain/web-search-query.js";
import { resolveTextInputFromExplicitOrReply, type ReplyContextInput, type ReplyInputSource } from "../../../common/reply-context-input.js";

export type WebSearchCommandKey = "search" | "google";

export const parseWebSearchCommand = (
  commandBody: string,
  input?: { replyContext?: ReplyContextInput }
): { ok: true; query: string; source: ReplyInputSource } | { ok: false; reason: "missing_query" | "incompatible_reply" } => {
  const raw = commandBody.replace(/^(search|google)\b/i, "");
  const resolved = resolveTextInputFromExplicitOrReply({
    explicitText: normalizeWebQuery(raw),
    replyContext: input?.replyContext
  });

  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason === "incompatible_reply" ? "incompatible_reply" : "missing_query" };
  }

  return { ok: true, query: normalizeWebQuery(resolved.text), source: resolved.source };
};
