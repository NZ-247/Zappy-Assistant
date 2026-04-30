import type { Redis } from "ioredis";
import type { DecisionInput, GovernancePolicySnapshot, GovernancePort } from "@zappy/core";

const KEY_VERSION = "v2";
const DEFAULT_TTL_SECONDS = 30;

const buildCacheKey = (input: DecisionInput): string => {
  const g = input.group?.waGroupId ?? "_";
  return `gov:snap:${KEY_VERSION}:${input.tenant.id}:${input.user.waUserId}:${g}:${input.context.scope}`;
};

// JSON round-trip loses Date objects — restore them so downstream callers aren't surprised.
const rehydrateDates = (s: GovernancePolicySnapshot): GovernancePolicySnapshot => ({
  ...s,
  evaluatedAt: new Date(s.evaluatedAt as unknown as string),
  group: {
    ...s.group,
    botAdminCheckedAt: s.group.botAdminCheckedAt
      ? new Date(s.group.botAdminCheckedAt as unknown as string)
      : null
  },
  access: {
    ...s.access,
    user: {
      ...s.access.user,
      approvedAt: s.access.user.approvedAt
        ? new Date(s.access.user.approvedAt as unknown as string)
        : null
    },
    group: {
      ...s.access.group,
      approvedAt: s.access.group.approvedAt
        ? new Date(s.access.group.approvedAt as unknown as string)
        : null
    }
  }
});

/**
 * Wraps a GovernancePort and caches getSnapshot() results in Redis.
 * consumeQuota always passes through to the base port (never cached).
 * TTL defaults to 30s — safe staleness window for governance data.
 */
export const createCachedGovernancePort = (
  base: GovernancePort,
  redis: Redis,
  ttlSeconds = DEFAULT_TTL_SECONDS
): GovernancePort => {
  const port: GovernancePort = {
    getSnapshot: async (input: DecisionInput): Promise<GovernancePolicySnapshot> => {
      const key = buildCacheKey(input);
      try {
        const cached = await redis.get(key);
        if (cached) {
          return rehydrateDates(JSON.parse(cached) as GovernancePolicySnapshot);
        }
      } catch {
        // Redis unavailable — fall through to DB
      }
      const snapshot = await base.getSnapshot(input);
      try {
        await redis.set(key, JSON.stringify(snapshot), "EX", ttlSeconds);
      } catch {
        // Non-fatal: cache write failure doesn't break the flow
      }
      return snapshot;
    }
  };

  if (base.consumeQuota) {
    port.consumeQuota = (input) => base.consumeQuota!(input);
  }

  return port;
};
