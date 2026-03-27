import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaDownloadPort } from "@zappy/core";
import type {
  MediaResolverResolveRequest,
  MediaResolverResolveResult,
  MediaResolverResultKind
} from "@zappy/shared";

interface LoggerLike {
  debug?: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
}

interface RedisLike {
  get: (...args: any[]) => Promise<string | null>;
  set: (...args: any[]) => Promise<unknown>;
  zadd: (...args: any[]) => Promise<unknown>;
  zrangebyscore: (...args: any[]) => Promise<string[]>;
  zrem: (...args: any[]) => Promise<unknown>;
}

export interface MediaResolverServiceInput {
  mediaDownload: MediaDownloadPort;
  redis: RedisLike;
  logger?: LoggerLike;
  tempDir: string;
  tempRetentionSeconds?: number;
  jobTtlSeconds: number;
  maxRetryAttempts?: number;
}

export interface MediaResolverService {
  resolve: (request: MediaResolverResolveRequest) => Promise<MediaResolverResolveResult>;
  runExpiredTempCleanup: (limit?: number) => Promise<number>;
}

type ResolveResult = Awaited<ReturnType<MediaDownloadPort["resolve"]>>;

const TMP_FILES_ZSET_KEY = "media-resolver:tmp-files";
const JOB_KEY_PREFIX = "media-resolver:job:";
const IDEM_KEY_PREFIX = "media-resolver:idem:";

const RESULT_KINDS = new Set<MediaResolverResultKind>([
  "preview_only",
  "image_post",
  "video_post",
  "reel_video",
  "blocked",
  "private",
  "login_required",
  "unsupported"
]);

const extensionFromMime = (mimeType?: string): string => {
  const normalized = (mimeType ?? "").toLowerCase();
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  return "bin";
};

const normalizeResultKind = (input: {
  status: "ready" | "unsupported" | "blocked" | "invalid" | "error";
  provider: "yt" | "ig" | "fb" | "direct";
  reason?: string;
  canonicalUrl?: string;
  url?: string;
  explicitResultKind?: string;
  assetKind?: "audio" | "video" | "image" | "document";
}): MediaResolverResultKind => {
  const explicit = input.explicitResultKind?.trim() as MediaResolverResultKind | undefined;
  if (explicit && RESULT_KINDS.has(explicit)) return explicit;

  const reason = (input.reason ?? "").toLowerCase();
  if (reason.includes("preview_only")) return "preview_only";
  if (reason.includes("private")) return "private";
  if (reason.includes("login")) return "login_required";
  if (input.status === "blocked") return "blocked";

  if (input.status === "ready") {
    if (input.assetKind === "image") return "image_post";
    if (input.assetKind === "video") {
      const canonical = `${input.canonicalUrl ?? ""} ${input.url ?? ""}`.toLowerCase();
      if (canonical.includes("/reel/") || reason.includes("reel")) return "reel_video";
      return "video_post";
    }
  }

  return "unsupported";
};

const isRetryableError = (status: "ready" | "unsupported" | "blocked" | "invalid" | "error", reason?: string): boolean => {
  if (status !== "error") return false;
  const normalized = (reason ?? "").toLowerCase();
  return (
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("tempor") ||
    normalized.includes("resolver_http_5") ||
    normalized.includes("http_50") ||
    normalized.includes("http_502") ||
    normalized.includes("http_503") ||
    normalized.includes("http_504")
  );
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parseJsonSafe = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const createMediaResolverService = async (input: MediaResolverServiceInput): Promise<MediaResolverService> => {
  const jobTtlSeconds = Math.max(60, input.jobTtlSeconds);
  const tempRetentionSeconds = Math.max(60, input.tempRetentionSeconds ?? jobTtlSeconds);
  const maxRetryAttempts = Math.max(1, input.maxRetryAttempts ?? 2);
  const tempDir = path.resolve(input.tempDir);

  await mkdir(tempDir, { recursive: true });

  const resolveWithRetries = async (request: MediaResolverResolveRequest) => {
    let attempts = 0;
    let lastResult: ResolveResult | null = null;

    while (attempts < maxRetryAttempts) {
      attempts += 1;
      const resolved = await input.mediaDownload.resolve({
        provider: request.provider,
        url: request.url,
        tenantId: request.tenantId,
        waUserId: request.waUserId,
        waGroupId: request.waGroupId,
        quality: request.quality,
        maxBytes: request.maxBytes
      });

      lastResult = resolved;
      if (!isRetryableError(resolved.status, resolved.reason) || attempts >= maxRetryAttempts) {
        return { attempts, result: resolved };
      }

      input.logger?.warn?.(
        {
          capability: "downloads",
          status: "resolver_retry",
          provider: resolved.provider,
          attempts,
          reason: resolved.reason
        },
        "media resolver retrying transient failure"
      );

      await sleep(120 * attempts);
    }

    if (lastResult) {
      return {
        attempts,
        result: lastResult
      };
    }

    const fallbackResult: ResolveResult = {
      provider: request.provider ?? "direct",
      status: "error",
      resultKind: "unsupported",
      reason: "resolver_unknown_failure",
      url: request.url
    };

    return {
      attempts,
      result: fallbackResult
    };
  };

  const persistTempAssetIfPresent = async (inputValue: {
    jobId: string;
    result: ResolveResult;
  }): Promise<string[]> => {
    const asset = inputValue.result.asset;
    const bufferBase64 = asset?.bufferBase64;
    if (!asset || !bufferBase64) return [];

    const ext = extensionFromMime(asset.mimeType);
    const tempPath = path.join(tempDir, `${inputValue.jobId}.${ext}`);
    const buffer = Buffer.from(bufferBase64, "base64");

    await writeFile(tempPath, buffer);

    const expiresAtMs = Date.now() + tempRetentionSeconds * 1000;
    await input.redis.zadd(TMP_FILES_ZSET_KEY, expiresAtMs, tempPath);
    return [tempPath];
  };

  const resolve = async (request: MediaResolverResolveRequest): Promise<MediaResolverResolveResult> => {
    if (request.idempotencyKey) {
      const cached = parseJsonSafe<MediaResolverResolveResult>(
        await input.redis.get(`${IDEM_KEY_PREFIX}${request.idempotencyKey}`)
      );
      if (cached) {
        input.logger?.debug?.(
          {
            capability: "downloads",
            status: "idempotency_hit",
            idempotencyKey: request.idempotencyKey,
            provider: cached.provider,
            resultStatus: cached.status,
            resultKind: cached.resultKind,
            jobId: cached.jobId
          },
          "media resolver idempotency cache hit"
        );
        return cached;
      }
    }

    const jobId = randomUUID();
    const startedAt = Date.now();
    const { attempts, result } = await resolveWithRetries(request);
    const resultKind = normalizeResultKind({
      status: result.status,
      provider: result.provider,
      reason: result.reason,
      canonicalUrl: result.canonicalUrl,
      url: result.url,
      explicitResultKind: result.resultKind,
      assetKind: result.asset?.kind
    });

    const tempFiles = await persistTempAssetIfPresent({ jobId, result });

    await input.redis.set(
      `${JOB_KEY_PREFIX}${jobId}`,
      JSON.stringify({
        provider: result.provider,
        status: result.status,
        resultKind,
        reason: result.reason,
        url: result.url,
        canonicalUrl: result.canonicalUrl,
        attempts,
        tempFiles,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString()
      }),
      "EX",
      jobTtlSeconds
    );

    const response: MediaResolverResolveResult = {
      provider: result.provider,
      detectedProvider: result.detectedProvider,
      status: result.status,
      resultKind,
      reason: result.reason,
      title: result.title,
      canonicalUrl: result.canonicalUrl,
      url: result.url,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
      asset: result.asset,
      jobId
    };

    if (request.idempotencyKey) {
      await input.redis.set(
        `${IDEM_KEY_PREFIX}${request.idempotencyKey}`,
        JSON.stringify(response),
        "EX",
        jobTtlSeconds
      );
    }

    return response;
  };

  const runExpiredTempCleanup = async (limit = 100): Promise<number> => {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const now = Date.now();
    const expired = await input.redis.zrangebyscore(TMP_FILES_ZSET_KEY, 0, now, "LIMIT", 0, safeLimit);

    if (!expired.length) return 0;

    let removed = 0;
    for (const tempPath of expired) {
      try {
        await unlink(tempPath);
      } catch {
        // noop
      }
      await input.redis.zrem(TMP_FILES_ZSET_KEY, tempPath);
      removed += 1;
    }

    if (removed > 0) {
      input.logger?.info?.(
        {
          capability: "downloads",
          status: "temp_cleanup",
          removed
        },
        "media resolver temp cleanup executed"
      );
    }

    return removed;
  };

  return {
    resolve,
    runExpiredTempCleanup
  };
};
