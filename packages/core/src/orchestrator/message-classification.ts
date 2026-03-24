import { parseCommandText } from "../commands/parser/parse-command.js";
import type { CommandRegistry } from "../commands/registry/command-types.js";
import type { PipelineContext, NormalizedEvent } from "../pipeline/context.js";
import type { MessageClassification } from "../pipeline/types.js";

const normalizeGreetingText = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const getPriorMessages = (ctx: PipelineContext) => {
  const history = ctx.recentMessages ?? [];
  if (history.length === 0) return [];
  const last = history[history.length - 1];
  const sameAsCurrent = last.role === "user" && last.content?.trim?.() === ctx.event.text?.trim?.();
  return sameAsCurrent ? history.slice(0, -1) : history;
};

const hasConversationContext = (ctx: PipelineContext): boolean => {
  const prior = getPriorMessages(ctx);
  return prior.length > 0;
};

const isPrivilegedChat = (ctx: PipelineContext, hasRootPrivilege: (ctx: PipelineContext) => boolean): boolean => {
  if (hasRootPrivilege(ctx)) return true;
  return ["creator_root", "mother_privileged", "delegated_owner"].includes(ctx.relationshipProfile);
};

const isSmallTalkFollowUp = (ctx: PipelineContext): boolean => {
  if (!hasConversationContext(ctx)) return false;
  const normalized = normalizeGreetingText(ctx.event.normalizedText);
  if (!normalized) return false;
  const smallTalkTokens = new Set(["bele", "beleza", "ta", "t", "joia", "kk", "kkk"]);
  const tokens = normalized.split(" ");
  if (tokens.length > 3) return false;
  return tokens.every((token) => smallTalkTokens.has(token)) || smallTalkTokens.has(normalized);
};

const isEchoFromAssistant = (ctx: PipelineContext): boolean => {
  const lastAssistant = [...ctx.recentMessages].reverse().find((message) => message.role === "assistant");
  return Boolean(lastAssistant && lastAssistant.content.trim() === ctx.event.normalizedText);
};

export interface MessageClassificationDeps {
  commandRegistry: CommandRegistry;
  isDuplicate: (event: NormalizedEvent) => Promise<boolean>;
  hasRootPrivilege: (ctx: PipelineContext) => boolean;
}

export const isGreetingPattern = (pattern: string): boolean => {
  const normalized = normalizeGreetingText(pattern);
  const greetings = new Set(["oi", "oii", "ola", "bom dia", "boa tarde", "boa noite"]);
  return greetings.has(normalized);
};

export const isGreetingMessage = (text: string): boolean => {
  const normalized = normalizeGreetingText(text);
  if (!normalized) return false;
  const tokens = normalized.split(" ");
  if (tokens.length > 2) return false;
  const singleGreetings = new Set(["oi", "oii", "ola"]);
  const duoGreetings = new Set(["bom dia", "boa tarde", "boa noite"]);
  if (tokens.length === 1) return singleGreetings.has(tokens[0]);
  const joined = tokens.join(" ");
  return duoGreetings.has(joined);
};

export const shouldSkipGenericGreeting = (
  ctx: PipelineContext,
  deps: Pick<MessageClassificationDeps, "hasRootPrivilege">
): boolean => {
  if (isPrivilegedChat(ctx, deps.hasRootPrivilege)) return true;
  if (hasConversationContext(ctx)) return true;
  if (isSmallTalkFollowUp(ctx)) return true;
  return false;
};

export const classifyMessage = async (ctx: PipelineContext, deps: MessageClassificationDeps): Promise<MessageClassification> => {
  const { event } = ctx;

  if (event.isStatusBroadcast) return { kind: "ignored_event", reason: "status_broadcast" };
  if (event.isFromBot) return { kind: "ignored_event", reason: "from_bot" };
  if (event.messageKind === "system") return { kind: "system_event" };
  if (ctx.conversationState.state === "WAITING_CONSENT") return { kind: "consent_pending", reason: "consent_required" };
  if (!event.normalizedText && !event.hasMedia) return { kind: "ignored_event", reason: "empty_payload" };
  if (event.hasMedia && !event.normalizedText && ctx.downloadsMode === "off") {
    return { kind: "ignored_event", reason: "media_not_allowed" };
  }
  if (await deps.isDuplicate(event)) return { kind: "ignored_event", reason: "duplicate" };
  if (isEchoFromAssistant(ctx)) return { kind: "ignored_event", reason: "loop_guard" };
  if (ctx.conversationState.state !== "NONE") return { kind: "tool_follow_up", reason: ctx.conversationState.state };

  const parsedCommand = parseCommandText(event.normalizedText, deps.commandRegistry);
  if (parsedCommand) {
    const match = parsedCommand.match;
    const commandName = match?.command.name ?? parsedCommand.token;
    return { kind: "command", commandName, commandKnown: Boolean(match), reason: match ? undefined : "unknown_command" };
  }

  if (event.isGroup && (ctx.isBotMentioned || ctx.isReplyToBot)) {
    return { kind: "ai_candidate", reason: "addressed_in_group" };
  }

  if (event.normalizedText.length > 120 || event.normalizedText.includes("?") || event.normalizedText.split(/\s+/).length > 6) {
    return { kind: "ai_candidate" };
  }

  return { kind: "trigger_candidate" };
};
