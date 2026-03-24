import type { AdminActionResultKind } from "../admin-actions.js";

export type BotAdminStatus = {
  isAdmin?: boolean;
  checkedAt: number;
  source: "cache" | "live" | "fallback" | "operation";
  error?: string;
  cached?: boolean;
  metadataFetched?: boolean;
  metadataError?: string;
  participantFound?: boolean;
  participantAdmin?: boolean;
  participantAdminLabel?: string | boolean | null;
  botJidRaw?: string;
  botJidNormalized?: string;
  actionResultKind?: AdminActionResultKind;
  actionErrorMessage?: string;
};

interface BotAdminStatusServiceDeps {
  getSocket: () => any | null;
  normalizeJid: (jid: string) => string;
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  logger: {
    debug?: (payload: unknown, message?: string) => void;
  };
  attemptGroupAdminAction: (input: {
    actionName: string;
    groupJid: string;
    run: () => Promise<unknown>;
  }) => Promise<{ kind: AdminActionResultKind; attemptedAt: number; errorMessage?: string }>;
  groupAccessRepository: {
    getGroupAccess: (input: {
      tenantId: string;
      waGroupId: string;
      groupName?: string;
      botIsAdmin?: boolean;
    }) => Promise<{ botIsAdmin?: boolean | null }>;
  };
  findPersistedGroup: (waGroupId: string) => Promise<{ tenantId: string; name?: string | null; botIsAdmin?: boolean | null } | null>;
}

export const GROUP_ADMIN_CACHE_TTL_MS = 3 * 60 * 1000;
export const GROUP_ADMIN_OPERATION_CACHE_TTL_MS = 10 * 60 * 1000;

export const createBotAdminStatusService = (deps: BotAdminStatusServiceDeps) => {
  const groupAdminCache = new Map<string, BotAdminStatus>();

  const ensureBotAdminStatus = async (
    groupJid: string,
    options?: { forceRefresh?: boolean; operationFirst?: boolean; reason?: string }
  ): Promise<BotAdminStatus> => {
    const now = Date.now();
    const cached = groupAdminCache.get(groupJid);
    const cacheTtl = cached?.source === "operation" ? GROUP_ADMIN_OPERATION_CACHE_TTL_MS : GROUP_ADMIN_CACHE_TTL_MS;
    if (!options?.forceRefresh && cached && now - cached.checkedAt < cacheTtl) {
      return { ...cached, cached: true };
    }

    const socket = deps.getSocket();
    const botJidRaw = socket?.user?.id;
    const botJidNormalized = botJidRaw ? deps.normalizeJid(botJidRaw) : undefined;

    if (!botJidRaw) {
      const fallback: BotAdminStatus = {
        isAdmin: cached?.isAdmin,
        checkedAt: now,
        source: "fallback",
        error: "socket_not_ready",
        metadataFetched: false,
        botJidRaw,
        botJidNormalized
      };
      groupAdminCache.set(groupJid, fallback);
      return fallback;
    }

    const shouldProbeOperation =
      options?.operationFirst || !cached || cached.source === "fallback" || cached.isAdmin === false || options?.forceRefresh;

    const operationResult = shouldProbeOperation
      ? await deps.attemptGroupAdminAction({
          actionName: "probe_group_admin",
          groupJid,
          run: async () => socket.groupInviteCode(groupJid)
        })
      : null;

    let metadataFetched = false;
    let participantFound = false;
    let participantAdmin: boolean | undefined;
    let participantAdminLabel: string | boolean | null = null;
    let metadataError: string | undefined;

    try {
      const metadata = await socket.groupMetadata(groupJid);
      metadataFetched = true;
      const participant = metadata?.participants?.find((p: any) => deps.normalizeJid(p.id) === botJidNormalized);
      participantFound = Boolean(participant);
      participantAdminLabel = participant?.admin ?? participant?.isAdmin ?? null;
      participantAdmin =
        participant &&
        (participant.admin === "admin" ||
          participant.admin === "superadmin" ||
          participant.isAdmin === true ||
          participant.admin === true);
    } catch (error) {
      metadataError = (error as Error)?.message ?? "metadata_fetch_failed";
    }

    const buildStatus = (): BotAdminStatus => {
      const base: BotAdminStatus = {
        isAdmin: undefined,
        checkedAt: now,
        source: "fallback",
        botJidRaw,
        botJidNormalized,
        metadataFetched,
        metadataError,
        participantFound,
        participantAdmin,
        participantAdminLabel
      };

      if (operationResult) {
        const { kind, attemptedAt, errorMessage } = operationResult;
        if (kind === "success") {
          return {
            ...base,
            isAdmin: true,
            checkedAt: attemptedAt,
            source: "operation",
            actionResultKind: kind,
            actionErrorMessage: errorMessage
          };
        }
        if (kind === "failed_not_admin" || kind === "failed_not_authorized") {
          return {
            ...base,
            isAdmin: false,
            checkedAt: attemptedAt,
            source: "operation",
            actionResultKind: kind,
            actionErrorMessage: errorMessage
          };
        }
        return {
          ...base,
          checkedAt: attemptedAt,
          source: "operation",
          actionResultKind: kind,
          actionErrorMessage: errorMessage,
          isAdmin: cached?.isAdmin ?? undefined
        };
      }

      if (metadataFetched && typeof participantAdmin === "boolean") {
        return { ...base, isAdmin: participantAdmin, source: "live" };
      }

      if (cached) {
        const derivedSource = cached.source === "operation" ? "operation" : cached.source ?? "cache";
        return { ...base, isAdmin: cached.isAdmin, source: derivedSource };
      }

      return base;
    };

    const status = buildStatus();
    groupAdminCache.set(groupJid, status);
    return status;
  };

  const resolveSenderGroupAdmin = async (groupJid: string, waUserId: string): Promise<boolean | undefined> => {
    const socket = deps.getSocket();
    if (!socket) return undefined;
    try {
      const meta = await socket.groupMetadata(groupJid);
      const target = deps.normalizeJid(waUserId);
      const participant = meta?.participants?.find((p: any) => deps.normalizeJid(p.id) === target);
      if (!participant) return undefined;
      const adminFlag = (participant.admin ?? "").toString().toLowerCase();
      return adminFlag === "admin" || adminFlag === "superadmin";
    } catch (error) {
      deps.logger.debug?.(
        deps.withCategory("WARN", { action: "resolve_sender_admin", waGroupId: groupJid, waUserId, error }),
        "failed to resolve sender admin"
      );
      return undefined;
    }
  };

  const refreshBotAdminState = async (input: {
    waGroupId: string;
    tenantId?: string;
    groupName?: string | null;
    force?: boolean;
    origin?: string;
    guardSource?: string;
    operationFirst?: boolean;
  }) => {
    const existing = input.waGroupId ? await deps.findPersistedGroup(input.waGroupId) : null;
    const status = await ensureBotAdminStatus(input.waGroupId, {
      forceRefresh: input.force,
      operationFirst: input.operationFirst,
      reason: input.origin
    });
    let persistedAfter = existing?.botIsAdmin;

    const shouldPersist = status.source === "live" || status.source === "operation";
    if (shouldPersist && input.tenantId && typeof status.isAdmin === "boolean") {
      const updated = await deps.groupAccessRepository.getGroupAccess({
        tenantId: input.tenantId,
        waGroupId: input.waGroupId,
        groupName: input.groupName ?? undefined,
        botIsAdmin: status.isAdmin
      });
      persistedAfter = updated.botIsAdmin;
    }

    if (process.env.NODE_ENV !== "production") {
      const socket = deps.getSocket();
      const botJidRaw = status.botJidRaw ?? socket?.user?.id;
      const botJidNormalized = status.botJidNormalized ?? (botJidRaw ? deps.normalizeJid(botJidRaw) : undefined);
      deps.logger.debug?.(
        deps.withCategory("SYSTEM", {
          waGroupId: input.waGroupId,
          origin: input.origin ?? "refreshBotAdminState",
          guardSource: input.guardSource,
          botJidRaw,
          botJidNormalized,
          metadataFetched: Boolean(status.metadataFetched),
          participantFound: Boolean(status.participantFound),
          participantAdmin: status.participantAdmin,
          participantAdminLabel: status.participantAdminLabel,
          source: status.source,
          liveIsAdmin: status.isAdmin,
          persistedBefore: existing?.botIsAdmin,
          persistedAfter,
          error: status.error ?? status.metadataError ?? status.actionErrorMessage,
          metadataError: status.metadataError,
          actionResultKind: status.actionResultKind,
          actionErrorMessage: status.actionErrorMessage,
          checkedAt: new Date(status.checkedAt).toISOString()
        }),
        "bot admin detection"
      );
    }

    return status;
  };

  return {
    ensureBotAdminStatus,
    resolveSenderGroupAdmin,
    refreshBotAdminState
  };
};
