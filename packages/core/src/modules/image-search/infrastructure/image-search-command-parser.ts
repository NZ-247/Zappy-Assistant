import { normalizeImageQuery } from "../domain/image-search-query.js";
import { resolveTextInputFromExplicitOrReply, type ReplyContextInput, type ReplyInputSource } from "../../../common/reply-context-input.js";

export type ImageSearchCommandKey = "img" | "gimage" | "imglink";

export const parseImageSearchCommand = (
  commandBody: string,
  input?: { replyContext?: ReplyContextInput }
): { ok: true; query: string; source: ReplyInputSource } | { ok: false; reason: "missing_query" | "incompatible_reply" } => {
  const raw = commandBody.replace(/^(img|gimage|imglink)\b/i, "");
  const resolved = resolveTextInputFromExplicitOrReply({
    explicitText: normalizeImageQuery(raw),
    replyContext: input?.replyContext
  });

  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason === "incompatible_reply" ? "incompatible_reply" : "missing_query" };
  }

  return { ok: true, query: normalizeImageQuery(resolved.text), source: resolved.source };
};
