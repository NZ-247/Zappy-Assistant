import type { DownloadProviderResultKind, LoggerPort } from "@zappy/core";

export type BridgeProviderKey = "yt" | "fb";
export type BridgePhase = "probe" | "download" | "health";
export type BridgeStatus = "ready" | "unsupported" | "blocked" | "invalid" | "error";

export interface ServiceCallSuccess {
  ok: true;
  httpStatus: number;
  durationMs: number;
  body: unknown;
}

export interface ServiceCallFailure {
  ok: false;
  httpStatus?: number;
  durationMs: number;
  reason: string;
  error?: unknown;
}

export type ServiceCallResult = ServiceCallSuccess | ServiceCallFailure;

const STATUS_VALUES: BridgeStatus[] = ["ready", "unsupported", "blocked", "invalid", "error"];
const RESULT_KIND_VALUES: DownloadProviderResultKind[] = [
  "preview_only",
  "image_post",
  "video_post",
  "reel_video",
  "blocked",
  "private",
  "login_required",
  "unsupported"
];

const clampTimeout = (value: number): number => Math.max(2_000, Math.min(Math.trunc(value), 120_000));

const withTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampTimeout(timeoutMs));
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
};

const ensureTrailingSlash = (value: string): string => (value.endsWith("/") ? value : `${value}/`);

export const joinBaseUrlWithPath = (baseUrl: string, pathname: string): string => {
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return new URL(normalizedPath, ensureTrailingSlash(baseUrl)).toString();
};

const readPath = (input: unknown, dottedPath: string): unknown => {
  if (!isRecord(input)) return undefined;
  const segments = dottedPath.split(".").filter(Boolean);
  let current: unknown = input;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
};

export const isRecord = (input: unknown): input is Record<string, unknown> => {
  return typeof input === "object" && input !== null && !Array.isArray(input);
};

export const pickString = (input: unknown, paths: string[]): string | undefined => {
  for (const path of paths) {
    const value = readPath(input, path);
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized) continue;
    return normalized;
  }
  return undefined;
};

export const pickNumber = (input: unknown, paths: string[]): number | undefined => {
  for (const path of paths) {
    const value = readPath(input, path);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.trunc(parsed);
      }
    }
  }
  return undefined;
};

export const pickObject = (input: unknown, paths: string[]): Record<string, unknown> | undefined => {
  for (const path of paths) {
    const value = readPath(input, path);
    if (isRecord(value)) return value;
  }
  return undefined;
};

export const pickBoolean = (input: unknown, paths: string[]): boolean | undefined => {
  for (const path of paths) {
    const value = readPath(input, path);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no") return false;
    }
  }
  return undefined;
};

export const normalizeStatus = (value?: string): BridgeStatus | undefined => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (STATUS_VALUES.includes(normalized as BridgeStatus)) return normalized as BridgeStatus;
  if (normalized === "ok" || normalized === "success" || normalized === "done") return "ready";
  if (
    normalized.includes("preview") ||
    normalized.includes("metadata_only") ||
    normalized.includes("no_download") ||
    normalized.includes("no_asset")
  ) {
    return "unsupported";
  }
  if (normalized.includes("private") || normalized.includes("login") || normalized.includes("auth") || normalized.includes("forbidden")) {
    return "blocked";
  }
  if (normalized.includes("invalid") || normalized.includes("not_found") || normalized.includes("bad_url")) {
    return "invalid";
  }
  if (normalized.includes("unsupported") || normalized.includes("not_supported")) {
    return "unsupported";
  }
  if (normalized.includes("error") || normalized.includes("timeout") || normalized.includes("network") || normalized.includes("fail")) {
    return "error";
  }
  return undefined;
};

export const normalizeResultKind = (value?: string): DownloadProviderResultKind | undefined => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (RESULT_KIND_VALUES.includes(normalized as DownloadProviderResultKind)) return normalized as DownloadProviderResultKind;
  if (normalized.includes("preview") || normalized.includes("thumbnail")) return "preview_only";
  if (normalized.includes("reel") || normalized.includes("short")) return "reel_video";
  if (normalized.includes("image") || normalized.includes("photo")) return "image_post";
  if (normalized.includes("video")) return "video_post";
  if (normalized.includes("private")) return "private";
  if (normalized.includes("login") || normalized.includes("auth")) return "login_required";
  if (normalized.includes("blocked") || normalized.includes("forbidden")) return "blocked";
  if (normalized.includes("unsupported") || normalized.includes("not_supported")) return "unsupported";
  return undefined;
};

export const deriveStatusAndKind = (input: {
  explicitStatus?: string;
  explicitKind?: string;
  reason?: string;
  defaultReadyKind?: DownloadProviderResultKind;
}): { status: BridgeStatus; resultKind: DownloadProviderResultKind } => {
  const statusFromExplicit = normalizeStatus(input.explicitStatus);
  const kindFromExplicit = normalizeResultKind(input.explicitKind);
  const kindFromReason = normalizeResultKind(input.reason);

  const statusHint = `${statusFromExplicit ?? ""} ${input.reason ?? ""}`.toLowerCase();
  const derivedStatus =
    statusFromExplicit ??
    (statusHint.includes("private") || statusHint.includes("login") || statusHint.includes("auth") ? "blocked" : undefined) ??
    (statusHint.includes("preview") ? "unsupported" : undefined) ??
    (statusHint.includes("invalid") || statusHint.includes("not_found") ? "invalid" : undefined) ??
    "error";

  const derivedKind =
    kindFromExplicit ??
    kindFromReason ??
    (derivedStatus === "blocked" ? "blocked" : undefined) ??
    (derivedStatus === "ready" ? input.defaultReadyKind : undefined) ??
    "unsupported";

  return {
    status: derivedStatus,
    resultKind: derivedKind
  };
};

export const resolveAssetKindFromMime = (mimeType?: string): "audio" | "video" | "image" | "document" | undefined => {
  const normalized = (mimeType ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("image/")) return "image";
  return "document";
};

export const extractBase64Payload = (input?: string): string | undefined => {
  const raw = (input ?? "").trim();
  if (!raw) return undefined;
  const normalized = raw.startsWith("data:") ? raw.split(",").slice(1).join(",") : raw;
  const compact = normalized.replace(/\s+/g, "");
  if (!compact) return undefined;
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return undefined;
  return compact;
};

export const estimateBase64Size = (input?: string): number | undefined => {
  const payload = extractBase64Payload(input);
  if (!payload) return undefined;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
};

const parseJsonSafe = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      if (!text) return {};
      return { raw: text };
    } catch {
      return {};
    }
  }
};

export const callResolverService = async (input: {
  provider: BridgeProviderKey;
  providerName: string;
  phase: BridgePhase;
  baseUrl: string;
  token?: string;
  timeoutMs: number;
  logger?: LoggerPort;
  body?: unknown;
  method?: "GET" | "POST";
  path?: string;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}): Promise<ServiceCallResult> => {
  const method = input.method ?? "POST";
  const path = input.path ?? (input.phase === "health" ? "/health" : "/resolve");
  const endpoint = joinBaseUrlWithPath(input.baseUrl, path);
  const timeout = withTimeoutSignal(input.timeoutMs);
  const startedAt = Date.now();

  input.logger?.info?.(
    {
      capability: "downloads",
      provider: input.providerName,
      status: "provider_call_started",
      phase: input.phase,
      endpoint,
      timeoutMs: clampTimeout(input.timeoutMs)
    },
    "provider bridge call started"
  );

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(endpoint, {
      method,
      signal: timeout.signal,
      headers: {
        Accept: "application/json",
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        "User-Agent": `zappy-assistant/1.5 (${input.provider}-resolver-bridge)`
      },
      body: method === "POST" ? JSON.stringify(input.body ?? {}) : undefined
    });
  } catch (error) {
    timeout.clear();
    const reason = error instanceof Error && error.name === "AbortError" ? "resolver_timeout" : "resolver_network_error";
    input.logger?.warn?.(
      {
        capability: "downloads",
        provider: input.providerName,
        status: "provider_call_failed",
        phase: input.phase,
        endpoint,
        reason,
        error
      },
      "provider bridge call failed"
    );
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      reason,
      error
    };
  } finally {
    timeout.clear();
  }

  const durationMs = Date.now() - startedAt;
  const body = await parseJsonSafe(response);

  if (!response.ok) {
    const reason = `resolver_http_${response.status}`;
    input.logger?.warn?.(
      {
        capability: "downloads",
        provider: input.providerName,
        status: "provider_call_failed",
        phase: input.phase,
        endpoint,
        httpStatus: response.status,
        durationMs,
        reason
      },
      "provider bridge call failed"
    );
    return {
      ok: false,
      httpStatus: response.status,
      durationMs,
      reason
    };
  }

  input.logger?.info?.(
    {
      capability: "downloads",
      provider: input.providerName,
      status: "provider_call_success",
      phase: input.phase,
      endpoint,
      httpStatus: response.status,
      durationMs
    },
    "provider bridge call succeeded"
  );

  return {
    ok: true,
    httpStatus: response.status,
    durationMs,
    body
  };
};
