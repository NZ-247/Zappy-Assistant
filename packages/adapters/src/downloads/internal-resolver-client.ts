import { createHash } from "node:crypto";
import type { MediaDownloadPort, MediaDownloadProvider } from "@zappy/core";
import {
  INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
  mediaResolverResolveRequestSchema,
  mediaResolverResolveSuccessSchema
} from "@zappy/shared";

interface LoggerLike {
  debug?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
}

export interface InternalMediaResolverClientInput {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  logger?: LoggerLike;
}

const DEFAULT_TIMEOUT_MS = 25_000;

const parseJson = (raw: string): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const withTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
};

const buildIdempotencyKey = (request: {
  provider?: MediaDownloadProvider;
  url: string;
  tenantId?: string;
  waUserId?: string;
  waGroupId?: string;
  quality?: "low" | "medium" | "high" | "best";
  maxBytes?: number;
}): string => {
  const hash = createHash("sha1");
  hash.update(request.provider ?? "auto");
  hash.update("|");
  hash.update(request.url);
  hash.update("|");
  hash.update(request.tenantId ?? "-");
  hash.update("|");
  hash.update(request.waGroupId ?? "-");
  hash.update("|");
  hash.update(request.waUserId ?? "-");
  hash.update("|");
  hash.update(request.quality ?? "-");
  hash.update("|");
  hash.update(String(request.maxBytes ?? "-"));
  return `dl-${hash.digest("hex")}`;
};

export const createInternalMediaResolverClient = (input: InternalMediaResolverClientInput): MediaDownloadPort => {
  const endpoint = new URL(INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH, input.baseUrl).toString();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    resolve: async (request) => {
      const fallbackProvider = request.provider ?? "direct";
      const requestPayload = mediaResolverResolveRequestSchema.parse({
        provider: request.provider,
        url: request.url,
        tenantId: request.tenantId,
        waUserId: request.waUserId,
        waGroupId: request.waGroupId,
        quality: request.quality,
        maxBytes: request.maxBytes,
        idempotencyKey: buildIdempotencyKey(request)
      });

      const timeout = withTimeoutSignal(timeoutMs);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          signal: timeout.signal,
          headers: {
            authorization: `Bearer ${input.token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(requestPayload)
        });
      } catch (error) {
        timeout.clear();
        const reason = error instanceof Error && error.name === "AbortError" ? "resolver_timeout" : "resolver_network_error";
        return {
          provider: fallbackProvider,
          status: "error",
          resultKind: "unsupported",
          reason,
          url: request.url
        };
      } finally {
        timeout.clear();
      }

      const rawBody = await response.text();
      const responseBody = parseJson(rawBody);

      if (!response.ok) {
        input.logger?.warn?.(
          {
            capability: "downloads",
            provider: request.provider,
            status: "resolver_http_failure",
            route: INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
            httpStatus: response.status,
            tenantId: request.tenantId,
            responseBody
          },
          "internal media resolver request failed"
        );

        return {
          provider: fallbackProvider,
          status: response.status === 401 || response.status === 403 ? "blocked" : "error",
          resultKind: response.status === 401 || response.status === 403 ? "blocked" : "unsupported",
          reason: `resolver_http_${response.status}`,
          url: request.url
        };
      }

      const parsed = mediaResolverResolveSuccessSchema.safeParse(responseBody);
      if (!parsed.success) {
        input.logger?.warn?.(
          {
            capability: "downloads",
            provider: request.provider,
            status: "resolver_invalid_response",
            route: INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
            tenantId: request.tenantId,
            issues: parsed.error.issues
          },
          "internal media resolver response invalid"
        );

        return {
          provider: fallbackProvider,
          status: "error",
          resultKind: "unsupported",
          reason: "resolver_invalid_response",
          url: request.url
        };
      }

      input.logger?.debug?.(
        {
          capability: "downloads",
          provider: parsed.data.result.provider,
          status: "resolver_success",
          route: INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
          tenantId: request.tenantId,
          resultStatus: parsed.data.result.status,
          resultKind: parsed.data.result.resultKind,
          jobId: parsed.data.result.jobId
        },
        "internal media resolver request succeeded"
      );

      return {
        provider: parsed.data.result.provider,
        detectedProvider: parsed.data.result.detectedProvider,
        status: parsed.data.result.status,
        resultKind: parsed.data.result.resultKind,
        reason: parsed.data.result.reason,
        title: parsed.data.result.title,
        canonicalUrl: parsed.data.result.canonicalUrl,
        url: parsed.data.result.url,
        mimeType: parsed.data.result.mimeType,
        sizeBytes: parsed.data.result.sizeBytes,
        asset: parsed.data.result.asset
      };
    }
  };
};
