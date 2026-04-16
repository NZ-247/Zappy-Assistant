import type { InboundMessageEvent, Orchestrator, RelationshipProfile } from "@zappy/core";
import { createHash, randomUUID } from "node:crypto";
import { createCommandReactionAckLifecycle } from "../infrastructure/command-reaction-ack.js";

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
    INBOUND_STARTUP_WATERMARK_TOLERANCE_SECONDS: number;
    INBOUND_MISSING_TIMESTAMP_STARTUP_GRACE_SECONDS: number;
  };
  startupWatermarkMs: number;
  startupWatermarkIso: string;
  startupSessionId: string;
  getSocket: () => any | null;
  normalizeJid: (value: string) => string;
  buildBotAliases: (input: { pnJid?: string | null; lidJid?: string | null }) => string[];
  jidMatchesBot: (candidate: string | null | undefined, botAlias: string | null | undefined) => boolean;
  getInboundText: (message: any) => string;
  getInboundMessageType: (message: any) => string | undefined;
  hasInboundMedia: (message: any) => boolean;
  getInboundAudioMessage: (message: any) => { ptt?: boolean; mimeType?: string } | null;
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
    warn?: (payload: unknown, message?: string) => void;
  };
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  executeOutboundActions: (input: any) => Promise<void>;
  evaluateGovernanceDecision?: (input: {
    event: InboundMessageEvent;
    text: string;
    permissionRole?: string | null;
    relationshipProfile?: RelationshipProfile | null;
  }) => Promise<{
    evaluated: boolean;
    blocked: boolean;
    denyText?: string;
    capability?: string;
    route?: string;
    decision?: {
      reasonCodes?: string[];
      approval?: { state?: string };
      licensing?: { planId?: string | null; quota?: { limit?: number | null; used?: number | null; remaining?: number | null } };
      snapshot?: {
        scope?: "private" | "group";
        waGroupId?: string;
        waUserId?: string;
        access?: {
          effective?: {
            source?: "user" | "group" | "none";
          };
        };
      };
      capabilityPolicy?: {
        decisionSource?: string;
      };
    };
  }>;
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
    commandPrefix: string;
    progressReactions: {
      enabled: boolean;
      processingEmoji: string;
      successEmoji: string;
      failureEmoji: string;
    };
    audioConfig: {
      enabled: boolean;
      sttModel: string;
      sttTimeoutMs: number;
      maxDurationSeconds: number;
      maxBytes: number;
      language?: string;
      commandDispatchEnabled: boolean;
      commandPrefix: string;
      commandAllowlist: string[];
      commandMinConfidence: number;
      transcriptPreviewChars: number;
    };
    speechToText?: {
      transcribe: (input: {
        audio: Buffer;
        mimeType?: string;
        fileName?: string;
        language?: string;
        timeoutMs?: number;
        model?: string;
      }) => Promise<{ text: string; model?: string; language?: string; confidence?: number | null; elapsedMs?: number }>;
    };
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
  const startupWatermarkMs = deps.startupWatermarkMs;
  const startupWatermarkIso = deps.startupWatermarkIso;
  const startupSessionId = deps.startupSessionId;
  const startupToleranceMs = Math.max(0, deps.env.INBOUND_STARTUP_WATERMARK_TOLERANCE_SECONDS) * 1000;
  const startupCutoffMs = startupWatermarkMs - startupToleranceMs;
  const missingTimestampStartupGraceMs = Math.max(0, deps.env.INBOUND_MISSING_TIMESTAMP_STARTUP_GRACE_SECONDS) * 1000;
  const maxMessageAgeSeconds = Math.max(0, deps.env.INBOUND_MAX_MESSAGE_AGE_SECONDS);

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
      const claimed = await deps.claimInboundMessage({ remoteJid, waMessageId: inboundMessageId });
      if (!claimed) {
        deps.logger.info(
          deps.withCategory("WA-IN", {
            status: "duplicate_inbound_skipped",
            skipReason: "duplicate_claim",
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

      if (messageTimestampMs !== null) {
        if (messageTimestampMs < startupCutoffMs) {
          deps.logger.info(
            deps.withCategory("WA-IN", {
              status: "startup_watermark_inbound_skipped",
              skipReason: "startup_watermark",
              remoteJid,
              waUserId,
              waMessageId: inboundMessageId,
              executionId,
              messageTimestamp: new Date(messageTimestampMs).toISOString(),
              startupWatermark: startupWatermarkIso,
              startupSessionId,
              startupToleranceSeconds: Math.floor(startupToleranceMs / 1000),
              backlogSeconds: Math.max(0, Math.floor((startupWatermarkMs - messageTimestampMs) / 1000))
            }),
            "replay/backlog inbound skipped"
          );
          continue;
        }

        if (maxMessageAgeSeconds > 0) {
          const ageMs = Date.now() - messageTimestampMs;
          if (ageMs > maxMessageAgeSeconds * 1000) {
            deps.logger.info(
              deps.withCategory("WA-IN", {
                status: "stale_inbound_skipped",
                skipReason: "stale_age",
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
        }
      } else {
        const uptimeMs = Date.now() - startupWatermarkMs;
        if (uptimeMs <= missingTimestampStartupGraceMs) {
          deps.logger.info(
            deps.withCategory("WA-IN", {
              status: "startup_watermark_timestamp_missing_skipped",
              skipReason: "startup_watermark_timestamp_missing",
              remoteJid,
              waUserId,
              waMessageId: inboundMessageId,
              executionId,
              startupWatermark: startupWatermarkIso,
              startupSessionId,
              missingTimestampGraceSeconds: Math.floor(missingTimestampStartupGraceMs / 1000),
              uptimeSeconds: Math.max(0, Math.floor(uptimeMs / 1000))
            }),
            "replay/backlog inbound skipped"
          );
          continue;
        }

        if (maxMessageAgeSeconds > 0) {
          deps.logger.debug(
            deps.withCategory("WA-IN", {
              status: "replay_guard_timestamp_missing_accepted",
              remoteJid,
              waUserId,
              waMessageId: inboundMessageId,
              executionId,
              startupSessionId
            }),
            "replay guard timestamp missing; inbound accepted"
          );
        }
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
      const quotedMessage = (contextInfo as any)?.quotedMessage;
      const quotedMessageExists = Boolean(quotedMessage);
      const quotedMessageType = deps.getInboundMessageType(quotedMessage);
      const quotedText = deps.getInboundText(quotedMessage).trim() || undefined;
      const quotedHasMedia = deps.hasInboundMedia(quotedMessage);
      const quotedAudioPtt = deps.getInboundAudioMessage(quotedMessage)?.ptt;
      const learnedBotLid = await deps.maybeLearnBotLidFromQuote({
        quotedWaMessageId,
        quotedParticipantRaw: quotedWaUserIdRaw,
        quotedMessage
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
        rawMessageType: deps.getInboundMessageType(message.message) ?? "unknown",
        mentionedWaUserIds,
        isBotMentioned,
        quotedWaMessageId,
        quotedWaUserId,
        quotedMessageType,
        quotedText,
        quotedHasMedia,
        quotedAudioPtt,
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
      const canonical = context.canonicalIdentity;
      const relationshipProfile = context.relationshipProfile ?? canonical?.relationshipProfile;
      const permissionRole = context.user.permissionRole ?? canonical?.permissionRole ?? context.user.role;
      const normalizedPhone = canonical?.phoneNumber ? canonical.phoneNumber.replace(/\D/g, "") : undefined;

      const governanceEvaluation = deps.evaluateGovernanceDecision
        ? await deps.evaluateGovernanceDecision({
            event,
            text,
            permissionRole,
            relationshipProfile
          })
        : undefined;

      const persisted = await deps.persistInboundMessage({
        ...event,
        userId: context.user.id,
        groupId: context.group?.id,
        rawJson: message
      });
      event.conversationId = persisted.conversationId;

      if (governanceEvaluation?.blocked) {
        deps.logger.info(
          deps.withCategory("WA-IN", {
            status: "governance_enforcement_short_circuit",
            tenantId: event.tenantId,
            waGroupId: event.waGroupId,
            waUserId: event.waUserId,
            waMessageId: event.waMessageId,
            executionId: event.executionId,
            capability: governanceEvaluation.capability,
            route: governanceEvaluation.route,
            governanceScope: governanceEvaluation.decision?.snapshot?.scope,
            primaryPolicySubject:
              governanceEvaluation.decision?.snapshot?.scope === "group"
                ? { type: "group", id: governanceEvaluation.decision?.snapshot?.waGroupId ?? event.waGroupId ?? null }
                : { type: "user", id: governanceEvaluation.decision?.snapshot?.waUserId ?? event.waUserId },
            secondaryPolicySubject:
              governanceEvaluation.decision?.snapshot?.scope === "group"
                ? { type: "user", id: governanceEvaluation.decision?.snapshot?.waUserId ?? event.waUserId }
                : null,
            effectiveAccessSource: governanceEvaluation.decision?.snapshot?.access?.effective?.source,
            capabilityDecisionSource: governanceEvaluation.decision?.capabilityPolicy?.decisionSource,
            reasonCodes: governanceEvaluation.decision?.reasonCodes,
            approvalState: governanceEvaluation.decision?.approval?.state,
            planId: governanceEvaluation.decision?.licensing?.planId,
            quotaLimit: governanceEvaluation.decision?.licensing?.quota?.limit,
            quotaUsed: governanceEvaluation.decision?.licensing?.quota?.used
          }),
          "governance enforcement short-circuited inbound execution"
        );

        await deps.executeOutboundActions({
          actions: [{ kind: "reply_text", text: governanceEvaluation.denyText ?? "Esta ação não está disponível pelas políticas atuais." }],
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
          commandPrefix: deps.outboundRuntime.commandPrefix,
          progressReactions: deps.outboundRuntime.progressReactions,
          audioConfig: deps.outboundRuntime.audioConfig,
          speechToText: deps.outboundRuntime.speechToText,
          dispatchTranscribedText: async () => ({ hadResponses: false }),
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
        continue;
      }

      if (governanceEvaluation?.evaluated) {
        deps.logger.debug(
          deps.withCategory("WA-IN", {
            status: "governance_evaluation_pass",
            tenantId: event.tenantId,
            waGroupId: event.waGroupId,
            waUserId: event.waUserId,
            waMessageId: event.waMessageId,
            executionId: event.executionId,
            capability: governanceEvaluation.capability,
            route: governanceEvaluation.route,
            governanceScope: governanceEvaluation.decision?.snapshot?.scope,
            primaryPolicySubject:
              governanceEvaluation.decision?.snapshot?.scope === "group"
                ? { type: "group", id: governanceEvaluation.decision?.snapshot?.waGroupId ?? event.waGroupId ?? null }
                : { type: "user", id: governanceEvaluation.decision?.snapshot?.waUserId ?? event.waUserId },
            effectiveAccessSource: governanceEvaluation.decision?.snapshot?.access?.effective?.source
          }),
          "governance evaluated and allowed"
        );
      }
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

      const commandAck = createCommandReactionAckLifecycle({
        text,
        commandPrefix: deps.outboundRuntime.commandPrefix,
        progressReactions: deps.outboundRuntime.progressReactions,
        getSocket: deps.getSocket,
        message,
        remoteJid,
        event,
        logger: deps.logger,
        withCategory: deps.withCategory
      });
      await commandAck.start();

      const dispatchTranscribedText = async (input: {
        text: string;
        transcript: string;
        commandText?: string;
        action: "respond" | "dispatch_command";
      }): Promise<{ hadResponses: boolean; dispatchExecutionId?: string }> => {
        const dispatchText = input.text.trim();
        if (!dispatchText) {
          return { hadResponses: false };
        }
        const dispatchSuffix = createHash("sha1")
          .update(`${input.action}|${dispatchText}|${event.waMessageId}`)
          .digest("hex")
          .slice(0, 10);
        const syntheticWaMessageId = `${event.waMessageId}:stt:${dispatchSuffix}`;
        const dispatchExecutionId = `${executionId}:stt:${Date.now().toString(36)}:${dispatchSuffix}`;
        const syntheticEvent: InboundMessageEvent = {
          ...event,
          text: dispatchText,
          waMessageId: syntheticWaMessageId,
          executionId: dispatchExecutionId,
          timestamp: new Date(),
          hasMedia: false,
          kind: "text",
          rawMessageType: "sttTextMessage",
          ingressSource: "audio_stt",
          sttTranscript: input.transcript,
          sttCommandText: input.commandText,
          messageKey: {
            id: syntheticWaMessageId,
            remoteJid: event.remoteJid ?? remoteJid,
            fromMe: false,
            participant: event.messageKey?.participant
          }
        };

        deps.logger.info(
          deps.withCategory("WA-IN", {
            status: "audio_stt_dispatch",
            tenantId: syntheticEvent.tenantId,
            waGroupId: syntheticEvent.waGroupId,
            waUserId: syntheticEvent.waUserId,
            waMessageId: syntheticEvent.waMessageId,
            inboundWaMessageId: event.waMessageId,
            executionId: syntheticEvent.executionId,
            sttAction: input.action,
            sttCommandText: input.commandText,
            sttTranscriptPreview: input.transcript.slice(0, 120)
          }),
          "audio stt dispatch inbound"
        );

        const syntheticActions = await deps.orchestrator.handleInboundMessage(syntheticEvent);
        const hasOutput = syntheticActions.some((action) => action.kind !== "noop");
        if (!hasOutput) {
          return { hadResponses: false, dispatchExecutionId };
        }
        await deps.executeOutboundActions({
          actions: syntheticActions,
          isGroup,
          remoteJid,
          waUserId,
          event: syntheticEvent,
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
          commandPrefix: deps.outboundRuntime.commandPrefix,
          progressReactions: deps.outboundRuntime.progressReactions,
          audioConfig: deps.outboundRuntime.audioConfig,
          speechToText: deps.outboundRuntime.speechToText,
          dispatchTranscribedText,
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
        return { hadResponses: true, dispatchExecutionId };
      };

      try {
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
          commandPrefix: deps.outboundRuntime.commandPrefix,
          progressReactions: deps.outboundRuntime.progressReactions,
          audioConfig: deps.outboundRuntime.audioConfig,
          speechToText: deps.outboundRuntime.speechToText,
          dispatchTranscribedText,
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
        await commandAck.success();
      } catch (error) {
        await commandAck.failure();
        deps.logger.warn?.(
          deps.withCategory("WA-OUT", {
            status: "command_or_outbound_failure",
            pipelineDomain: "feature_pipeline",
            transportSessionStatus: "separate_from_wa_decrypt_issue",
            tenantId: event.tenantId,
            waGroupId: event.waGroupId,
            waUserId: event.waUserId,
            waMessageId: event.waMessageId,
            executionId: event.executionId,
            err: error
          }),
          "command/outbound execution failed"
        );
      }
    }
  };
};
