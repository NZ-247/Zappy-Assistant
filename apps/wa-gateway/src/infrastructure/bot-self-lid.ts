import type { Redis } from "ioredis";

interface BotSelfLidServiceDeps {
  redis: Redis;
  logger: { debug?: (payload: unknown, message?: string) => void; warn?: (payload: unknown, message?: string) => void };
  defaultBotName?: string;
  normalizeLidJid: (value?: string | null) => string | null;
  stripUser: (jid: string) => string | null;
  findOutboundByWaMessageId: (waMessageId: string) => Promise<boolean>;
}

interface MaybeLearnFromQuoteInput {
  quotedWaMessageId?: string;
  quotedParticipantRaw?: string;
  quotedMessage?: any;
}

const BOT_SELF_LID_KEY_BASE = "bot:self:lid";

export const createBotSelfLidService = (deps: BotSelfLidServiceDeps) => {
  let botSelfLid: string | null = null;
  let botSelfLidLoaded = false;
  let botSelfLidKey = `${BOT_SELF_LID_KEY_BASE}:${deps.defaultBotName ?? "default"}`;

  const setBotSelfLidKey = (botJid?: string | null) => {
    const suffix = deps.stripUser(botJid ?? "") || deps.defaultBotName || "default";
    const nextKey = `${BOT_SELF_LID_KEY_BASE}:${suffix}`;
    if (nextKey !== botSelfLidKey) {
      botSelfLidKey = nextKey;
      botSelfLidLoaded = false;
    }
  };

  const loadBotSelfLid = async (): Promise<string | null> => {
    if (botSelfLidLoaded) return botSelfLid;
    const stored = await deps.redis.get(botSelfLidKey);
    botSelfLid = deps.normalizeLidJid(stored);
    botSelfLidLoaded = true;
    return botSelfLid;
  };

  const learnBotSelfLid = async (candidate: string | null | undefined, reason: string): Promise<string | null> => {
    const lid = deps.normalizeLidJid(candidate);
    if (!lid) return null;
    await loadBotSelfLid();
    if (botSelfLid === lid) return botSelfLid;
    botSelfLid = lid;
    botSelfLidLoaded = true;
    await deps.redis.set(botSelfLidKey, lid);
    if (process.env.NODE_ENV !== "production") {
      deps.logger.debug?.(
        {
          category: "SYSTEM",
          action: "learn_bot_lid",
          lid,
          reason,
          key: botSelfLidKey
        },
        "learned bot self LID alias"
      );
    }
    return botSelfLid;
  };

  const getBotSelfLid = async (): Promise<string | null> => {
    await loadBotSelfLid();
    return botSelfLid;
  };

  const maybeLearnBotLidFromQuote = async (input: MaybeLearnFromQuoteInput): Promise<string | null> => {
    const candidate = deps.normalizeLidJid(input.quotedParticipantRaw);
    if (!candidate) return null;

    const quotedFromMe = Boolean(input.quotedMessage?.key?.fromMe);
    let outboundMatch = false;
    if (input.quotedWaMessageId) {
      try {
        outboundMatch = await deps.findOutboundByWaMessageId(input.quotedWaMessageId);
      } catch (error) {
        deps.logger.warn?.(
          {
            category: "WARN",
            action: "lookup_quoted_outbound",
            error
          },
          "failed to verify quoted outbound message"
        );
      }
    }

    if (!quotedFromMe && !outboundMatch) return null;
    return learnBotSelfLid(candidate, quotedFromMe ? "quote_from_me" : "quote_outbound_lookup");
  };

  return {
    setBotSelfLidKey,
    loadBotSelfLid,
    learnBotSelfLid,
    getBotSelfLid,
    maybeLearnBotLidFromQuote
  };
};
