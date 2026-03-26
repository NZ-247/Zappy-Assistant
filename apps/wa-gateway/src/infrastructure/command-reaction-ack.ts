import { createCommandRegistry } from "@zappy/core";
import type { ProgressReactionsConfig } from "./outbound/types.js";

type GatewayLogger = {
  debug?: (payload: unknown, message?: string) => void;
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
};

type EventLike = {
  tenantId: string;
  waGroupId?: string;
  waUserId: string;
  waMessageId: string;
  executionId?: string;
};

type MessageLike = {
  key?: {
    id?: string;
    remoteJid?: string;
    fromMe?: boolean;
    participant?: string;
  };
};

const registryCache = new Map<string, ReturnType<typeof createCommandRegistry>>();
const LEGACY_PROGRESS_ACK_COMMANDS = new Set(["img", "search", "google", "search-ai", "tts", "transcribe", "tss", "trl", "dl"]);

const extractCommandToken = (text: string, commandPrefix: string): string | undefined => {
  const trimmed = text.trim();
  if (!trimmed || !trimmed.startsWith(commandPrefix)) return undefined;
  const body = trimmed.slice(commandPrefix.length).trim().toLowerCase();
  if (!body) return undefined;
  return body.split(/\s+/)[0];
};

const getRegistry = (prefix: string) => {
  const cached = registryCache.get(prefix);
  if (cached) return cached;
  const created = createCommandRegistry(prefix);
  registryCache.set(prefix, created);
  return created;
};

const resolveCommandAckMetadata = (input: {
  text: string;
  commandPrefix: string;
}): { commandName: string; matchedAlias?: string } | null => {
  const trimmed = input.text.trim();
  if (!trimmed) return null;
  const match = getRegistry(input.commandPrefix).resolve(trimmed);
  if (match) {
    const progressAckEnabled = Boolean((match.command as any)?.progressAck) || LEGACY_PROGRESS_ACK_COMMANDS.has(match.command.name);
    if (!progressAckEnabled) return null;
    return {
      commandName: match.command.name,
      matchedAlias: match.matchedAlias
    };
  }

  const token = extractCommandToken(trimmed, input.commandPrefix);
  if (!token) return null;
  const aliasFallback: Record<string, string> = {
    tss: "transcribe"
  };
  const normalized = aliasFallback[token] ?? token;
  if (!LEGACY_PROGRESS_ACK_COMMANDS.has(normalized)) return null;
  return {
    commandName: normalized,
    matchedAlias: normalized === token ? undefined : token
  };
};

const resolveReactionKey = (
  message: MessageLike | undefined,
  remoteJid: string
): { id: string; remoteJid?: string; fromMe?: boolean; participant?: string } | null => {
  const id = message?.key?.id;
  if (!id) return null;
  return {
    id,
    remoteJid: message?.key?.remoteJid ?? remoteJid,
    fromMe: message?.key?.fromMe ?? false,
    participant: message?.key?.participant
  };
};

const buildPayload = (
  withCategory: ((category: unknown, payload?: Record<string, unknown>) => unknown) | undefined,
  payload: Record<string, unknown>
) => {
  if (!withCategory) return payload;
  return withCategory("WA-OUT", payload);
};

export const resolveCommandProgressAckDecision = (input: { text: string; commandPrefix: string }) => {
  const resolved = resolveCommandAckMetadata(input);
  return {
    enabled: Boolean(resolved),
    commandName: resolved?.commandName,
    matchedAlias: resolved?.matchedAlias
  };
};

export const createCommandReactionAckLifecycle = (input: {
  text: string;
  commandPrefix: string;
  progressReactions: ProgressReactionsConfig;
  getSocket: () => any | null;
  message: MessageLike;
  remoteJid: string;
  event: EventLike;
  logger: GatewayLogger;
  withCategory?: (category: unknown, payload?: Record<string, unknown>) => unknown;
}) => {
  const decision = resolveCommandProgressAckDecision({
    text: input.text,
    commandPrefix: input.commandPrefix
  });
  const enabled = decision.enabled && input.progressReactions.enabled;

  const send = async (phase: "start" | "success" | "failure", emoji: string): Promise<boolean> => {
    if (!enabled || !emoji.trim()) return false;

    const socket = input.getSocket();
    const key = resolveReactionKey(input.message, input.remoteJid);
    const logBase = {
      action: "command_ack",
      reactionPhase: phase,
      commandName: decision.commandName,
      matchedAlias: decision.matchedAlias,
      tenantId: input.event.tenantId,
      waGroupId: input.event.waGroupId,
      waUserId: input.event.waUserId,
      inboundWaMessageId: input.event.waMessageId,
      executionId: input.event.executionId
    };

    if (!socket || !key) {
      input.logger.debug?.(
        buildPayload(input.withCategory, {
          ...logBase,
          status: "skipped",
          reason: !socket ? "socket_unavailable" : "message_key_missing"
        }),
        "command ack skipped"
      );
      return false;
    }

    try {
      await socket.sendMessage(input.remoteJid, {
        react: {
          text: emoji,
          key
        }
      });

      input.logger.info?.(
        buildPayload(input.withCategory, {
          ...logBase,
          status: "success",
          emoji
        }),
        "command ack sent"
      );
      return true;
    } catch (error) {
      input.logger.warn?.(
        buildPayload(input.withCategory, {
          ...logBase,
          status: "failure",
          emoji,
          err: error
        }),
        "command ack failed"
      );
      return false;
    }
  };

  return {
    enabled,
    commandName: decision.commandName,
    start: async () => send("start", input.progressReactions.processingEmoji),
    success: async () => send("success", input.progressReactions.successEmoji),
    failure: async () => send("failure", input.progressReactions.failureEmoji)
  };
};
