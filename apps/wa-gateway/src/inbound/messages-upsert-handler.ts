import type { InboundMessageEvent, Orchestrator } from "@zappy/core";
import { createHash, randomUUID } from "node:crypto";

type InboundUpsertMessage = {
  key: { fromMe?: boolean; remoteJid?: string; participant?: string; id?: string };
  message?: { conversation?: string; extendedTextMessage?: { text?: string }; imageMessage?: { caption?: string } };
  messageTimestamp?: number | { toString: () => string };
  pushName?: string;
};

type InboundUpsertPayload = {
  messages: InboundUpsertMessage[];
  type: string;
};

interface MessagesUpsertHandlerDeps {
  orchestrator: Orchestrator;
  env: {
    ONLY_GROUP_ID?: string;
    DEFAULT_TENANT_NAME: string;
    BOT_TIMEZONE: string;
    INBOUND_MAX_MESSAGE_AGE_SECONDS: number;
  };
  getSocket: () => any | null;
  normalizeJid: (value: string) => string;
  buildBotAliases: (input: { pnJid?: string | null; lidJid?: string | null }) => string[];
  jidMatchesBot: (candidate: string | null | undefined, botAlias: string | null | undefined) => boolean;
  getInboundText: (message: any) => string;
  hasInboundMedia: (message: any) => boolean;
  getInboundContextInfo: (message: any) => any;
  setBotSelfLidKey: (botJid?: string | null) => void;
  getBotSelfLid: () => Promise<string | null>;
  maybeLearnBotLidFromQuote: (input: { quotedWaMessageId?: string; quotedParticipantRaw?: string; quotedMessage?: any }) => Promise<string | null>;
  ensureTenantContext: (input: {
    waGroupId?: string;
    waUserId: string;
    defaultTenantName: string;
    onlyGroupId?: string;
    remoteJid?: string;
    userName?: string | null;
  }) => Promise<any>;
  isBotAdminCommand: (text: string) => boolean;
  resolveSenderGroupAdmin: (groupJid: string, waUserId: string) => Promise<boolean | undefined>;
  refreshBotAdminState: (input: {
    waGroupId: string;
    tenantId?: string;
    groupName?: string | null;
    force?: boolean;
    origin?: string;
    operationFirst?: boolean;
  }) => Promise<any>;
  groupAdminOperationCacheTtlMs: number;
  claimInboundMessage: (input: { remoteJid: string; waMessageId: string }) => Promise<boolean>;
  inboundMessageClaimTtlSeconds: number;
  persistInboundMessage: (input: InboundMessageEvent & { userId: string; groupId?: string; rawJson: unknown }) => Promise<{ conversationId: string }>;
  logger: {
    debug: (payload: unknown, message?: string) => void;
    info: (payload: unknown, message?: string) => void;
  };
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  executeOutboundActions: (input: any) => Promise<void>;
  outboundRuntime: {
    sendWithReplyFallback: (input: { to: string; content: any; quotedMessage?: any; logContext: Record<string, unknown> }) => Promise<any>;
    persistOutboundMessage: (input: any) => Promise<unknown>;
    queueAdapter: any;
    groupAccessRepository: any;
    muteAdapter: any;
    attemptGroupAdminAction: any;
    downloadMediaMessage: any;
    baileysLogger: any;
    metrics: any;
    auditTrail: any;
    stickerMaxVideoSeconds: number;
  };
}

const buildInboundMessageId = (input: {
  message: InboundUpsertMessage;
  remoteJid: string;
  waUserId: string;
  text: string;
  mediaPresent: boolean;
}): string => {
  const explicit = input.message.key.id?.trim();
  if (explicit) return explicit;

  const timestamp = resolveMessageTimestampMs(input.message.messageTimestamp) ?? Date.now();
  const rawType = Object.keys(input.message.message ?? {})[0] ?? "unknown";
  const seed = [
    input.remoteJid,
    input.waUserId,
    input.message.key.participant ?? "",
    Number.isFinite(timestamp) ? String(timestamp) : "",
    rawType,
    input.mediaPresent ? "media" : "text",
    input.text.slice(0, 160)
  ].join("|");
  const hash = createHash("sha1").update(seed).digest("hex").slice(0, 20);
  return `auto_${hash}`;
};

const buildExecutionId = (waMessageId: string): string => {
  return `exec_${Date.now().toString(36)}_${waMessageId.slice(-8)}_${randomUUID().slice(0, 8)}`;
};

const resolveMessageTimestampMs = (rawTimestamp: InboundUpsertMessage["messageTimestamp"]): number | null => {
  if (rawTimestamp === undefined || rawTimestamp === null) return null;
  const rawValue = typeof rawTimestamp === "number" ? rawTimestamp : Number(rawTimestamp.toString?.() ?? rawTimestamp);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null;
  const millis = rawValue > 1_000_000_000_000 ? rawValue : rawValue * 1000;
  return Math.trunc(millis);
};

export const createMessagesUpsertHandler = (deps: MessagesUpsertHandlerDeps) => {
  return async ({ messages, type }: InboundUpsertPayload) => {
    const socket = deps.getSocket();
    if (type !== "notify" || !socket) return;

    for (const message of messages) {
      if (!message.message || message.key.fromMe) continue;
      const remoteJid = message.key.remoteJid;
      if (!remoteJid) continue;
      const isGroup = remoteJid.endsWith("@g.us");
      if (deps.env.ONLY_GROUP_ID && (!isGroup || remoteJid !== deps.env.ONLY_GROUP_ID)) continue;

      const waUserId = isGroup ? message.key.participant ?? "unknown" : remoteJid;
      const rawText = deps.getInboundText(message.message);
      const text = rawText.trim();
      const mediaPresent = deps.hasInboundMedia(message.message);
      if (!text && !mediaPresent) continue;
      const inboundMessageId = buildInboundMessageId({ message, remoteJid, waUserId, text, mediaPresent });
      const executionId = buildExecutionId(inboundMessageId);
      const messageTimestampMs = resolveMessageTimestampMs(message.messageTimestamp);
      const maxMessageAgeSeconds = Math.max(0, deps.env.INBOUND_MAX_MESSAGE_AGE_SECONDS);

      if (maxMessageAgeSeconds > 0 && messageTimestampMs !== null) {
        const ageMs = Date.now() - messageTimestampMs;
        if (ageMs > maxMessageAgeSeconds * 1000) {
          deps.logger.info(
            deps.withCategory("WA-IN", {
              status: "stale_inbound_skipped",
              remoteJid,
              waUserId,
              waMessageId: inboundMessageId,
              executionId,
              messageTimestamp: new Date(messageTimestampMs).toISOString(),
              messageAgeSeconds: Math.max(0, Math.floor(ageMs / 1000)),
              maxAgeSeconds: maxMessageAgeSeconds
            }),
            "stale inbound skipped"
          );
          continue;
        }
      } else if (maxMessageAgeSeconds > 0 && messageTimestampMs === null) {
        deps.logger.debug(
          deps.withCategory("WA-IN", {
            status: "stale_guard_timestamp_missing",
            remoteJid,
            waUserId,
            waMessageId: inboundMessageId,
            executionId
          }),
          "stale guard timestamp missing; inbound accepted"
        );
      }

      const botJid = socket.user?.id ? deps.normalizeJid(socket.user.id) : undefined;
      deps.setBotSelfLidKey(botJid);
      const storedBotLid = await deps.getBotSelfLid();
      const contextInfo = deps.getInboundContextInfo(message.message);
      const mentionedRaw = (contextInfo?.mentionedJid as string[] | undefined) ?? [];
      const mentionedWaUserIds = mentionedRaw.map((jid) => deps.normalizeJid(jid));
      const quotedWaMessageId = (contextInfo as any)?.stanzaId as string | undefined;
      const quotedWaUserIdRaw = (contextInfo as any)?.participant as string | undefined;
      const quotedWaUserId = quotedWaUserIdRaw ? deps.normalizeJid(quotedWaUserIdRaw) : undefined;
      const quotedRemoteJid = (contextInfo as any)?.remoteJid as string | undefined;
      const quotedMessageExists = Boolean((contextInfo as any)?.quotedMessage);
      const quotedMessageType =
        quotedMessageExists && typeof (contextInfo as any)?.quotedMessage === "object" && (contextInfo as any)?.quotedMessage
          ? Object.keys((contextInfo as any).quotedMessage)[0] ?? undefined
          : undefined;
      const learnedBotLid = await deps.maybeLearnBotLidFromQuote({
        quotedWaMessageId,
        quotedParticipantRaw: quotedWaUserIdRaw,
        quotedMessage: (contextInfo as any)?.quotedMessage
      });
      const botLid = learnedBotLid ?? storedBotLid;
      const botAliases = deps.buildBotAliases({ pnJid: socket.user?.id, lidJid: botLid });
      const isReplyToBot = botAliases.some((alias) => deps.jidMatchesBot(quotedWaUserIdRaw, alias));
      const isBotMentioned =
        botAliases.length > 0
          ? mentionedWaUserIds.some((jid) => botAliases.some((alias) => deps.jidMatchesBot(jid, alias)))
          : false;

      if (isGroup && process.env.NODE_ENV !== "production") {
        const textPreview = text.slice(0, 120);
        const line = [
          "[GROUP_DEBUG]",
          `text="${textPreview.replace(/"/g, '\\"')}"`,
          `remoteJid="${remoteJid}"`,
          `participant="${message.key.participant ?? ""}"`,
          `mentionedRaw=[${mentionedRaw.join(",")}]`,
          `mentionedNorm=[${mentionedWaUserIds.join(",")}]`,
          `botAliases=[${botAliases.join(",")}]`,
          `mentionMatched=${isBotMentioned}`,
          `quotedExists=${quotedMessageExists}`,
          `quotedParticipantRaw="${quotedWaUserIdRaw ?? ""}"`,
          `quotedParticipantNorm="${quotedWaUserId ?? ""}"`,
          `quotedRemoteJid="${quotedRemoteJid ?? ""}"`,
          `replyMatched=${isReplyToBot}`,
          `isBotMentioned=${isBotMentioned}`,
          `isReplyToBot=${isReplyToBot}`
        ].join(" ");
        deps.logger.debug(line);
      }

      const context = await deps.ensureTenantContext({
        waGroupId: isGroup ? remoteJid : undefined,
        waUserId,
        defaultTenantName: deps.env.DEFAULT_TENANT_NAME,
        onlyGroupId: deps.env.ONLY_GROUP_ID,
        remoteJid,
        userName: message.pushName ?? null
      });

      const lastAdminCheck = context.group?.botAdminCheckedAt?.getTime?.() ?? 0;
      const adminCommand = isGroup && deps.isBotAdminCommand(text);
      const senderIsGroupAdmin = isGroup ? await deps.resolveSenderGroupAdmin(remoteJid, waUserId) : undefined;
      const shouldForceAdminRefresh =
        isGroup &&
        (adminCommand ||
          !context.group?.botAdminCheckedAt ||
          Date.now() - lastAdminCheck > deps.groupAdminOperationCacheTtlMs ||
          context.group?.botIsAdmin === false);
      const botAdminStatus = isGroup
        ? await deps.refreshBotAdminState({
            waGroupId: remoteJid,
            tenantId: context.tenant.id,
            groupName: context.group?.name ?? message.pushName ?? remoteJid,
            force: shouldForceAdminRefresh,
            origin: "messages.upsert",
            operationFirst: shouldForceAdminRefresh
          })
        : undefined;
      const botAdminCheckedAt = botAdminStatus?.checkedAt ? new Date(botAdminStatus.checkedAt) : context.group?.botAdminCheckedAt ?? undefined;
      const botIsGroupAdmin = isGroup ? botAdminStatus?.isAdmin ?? context.group?.botIsAdmin ?? undefined : undefined;
      const botAdminError = botAdminStatus?.error ?? botAdminStatus?.metadataError ?? botAdminStatus?.actionErrorMessage;
      const botAdminCheckFailed =
        botAdminStatus?.source === "fallback" || botAdminStatus?.actionResultKind === "failed_metadata_unavailable";
      const messageKey = {
        id: inboundMessageId,
        remoteJid: message.key.remoteJid,
        fromMe: message.key.fromMe,
        participant: message.key.participant
      };

      const event: InboundMessageEvent = {
        tenantId: context.tenant.id,
        conversationId: undefined,
        waGroupId: isGroup ? remoteJid : undefined,
        waUserId,
        text,
        waMessageId: inboundMessageId,
        timestamp: new Date(messageTimestampMs ?? Date.now()),
        isGroup,
        remoteJid,
        isStatusBroadcast: remoteJid === "status@broadcast",
        isFromBot: Boolean(message.key.fromMe),
        hasMedia: mediaPresent,
        kind: text ? "text" : mediaPresent ? "media" : "unknown",
        rawMessageType: Object.keys(message.message ?? {})[0] ?? "unknown",
        mentionedWaUserIds,
        isBotMentioned,
        quotedWaMessageId,
        quotedWaUserId,
        quotedMessageType,
        isReplyToBot,
        senderIsGroupAdmin,
        botIsGroupAdmin,
        botAdminStatusSource: botAdminStatus?.source,
        botAdminCheckFailed,
        botAdminCheckError: botAdminError,
        botAdminCheckedAt,
        groupName: context.group?.name ?? message.pushName ?? remoteJid ?? undefined,
        messageKey,
        executionId
      };

      const claimed = await deps.claimInboundMessage({ remoteJid, waMessageId: inboundMessageId });
      if (!claimed) {
        deps.logger.info(
          deps.withCategory("WA-IN", {
            status: "duplicate_inbound_skipped",
            tenantId: event.tenantId,
            waGroupId: event.waGroupId,
            waMessageId: inboundMessageId,
            remoteJid,
            waUserId,
            executionId,
            claimTtlSeconds: deps.inboundMessageClaimTtlSeconds
          }),
          "duplicate inbound message skipped"
        );
        continue;
      }

      const persisted = await deps.persistInboundMessage({
        ...event,
        userId: context.user.id,
        groupId: context.group?.id,
        rawJson: message
      });
      event.conversationId = persisted.conversationId;
      const canonical = context.canonicalIdentity;
      const relationshipProfile = context.relationshipProfile ?? canonical?.relationshipProfile;
      const permissionRole = context.user.permissionRole ?? canonical?.permissionRole ?? context.user.role;
      const normalizedPhone = canonical?.phoneNumber ? canonical.phoneNumber.replace(/\D/g, "") : undefined;
      deps.logger.info(
        deps.withCategory("WA-IN", {
          tenantId: event.tenantId,
          scope: isGroup ? "group" : "direct",
          waUserId,
          phoneNumber: canonical?.phoneNumber,
          normalizedPhone,
          lidJid: canonical?.lidJid,
          pnJid: canonical?.pnJid,
          relationshipProfile,
          permissionRole,
          waMessageId: event.waMessageId,
          inboundMessageId: event.waMessageId,
          executionId: event.executionId,
          waGroupId: event.waGroupId,
          messageKeyId: event.messageKey?.id,
          textPreview: text.slice(0, 80),
          hasMedia: event.hasMedia,
          messageType: event.rawMessageType
        }),
        "inbound message"
      );

      const actions = await deps.orchestrator.handleInboundMessage(event);
      await deps.executeOutboundActions({
        actions,
        isGroup,
        remoteJid,
        waUserId,
        event,
        message,
        context,
        contextInfo,
        quotedWaMessageId,
        quotedWaUserId,
        canonical,
        normalizedPhone,
        relationshipProfile,
        permissionRole,
        timezone: deps.env.BOT_TIMEZONE,
        sendWithReplyFallback: deps.outboundRuntime.sendWithReplyFallback,
        persistOutboundMessage: deps.outboundRuntime.persistOutboundMessage,
        queueAdapter: deps.outboundRuntime.queueAdapter,
        groupAccessRepository: deps.outboundRuntime.groupAccessRepository,
        muteAdapter: deps.outboundRuntime.muteAdapter,
        attemptGroupAdminAction: deps.outboundRuntime.attemptGroupAdminAction,
        getSocket: deps.getSocket,
        downloadMediaMessage: deps.outboundRuntime.downloadMediaMessage,
        baileysLogger: deps.outboundRuntime.baileysLogger,
        normalizeJid: deps.normalizeJid,
        logger: deps.logger,
        withCategory: deps.withCategory,
        metrics: deps.outboundRuntime.metrics,
        auditTrail: deps.outboundRuntime.auditTrail,
        stickerMaxVideoSeconds: deps.outboundRuntime.stickerMaxVideoSeconds
      });
    }
  };
};
