import type { Boom } from "@hapi/boom";

export type AdminActionResultKind =
  | "success"
  | "failed_not_admin"
  | "failed_not_authorized"
  | "failed_metadata_unavailable"
  | "failed_unknown";

export type AdminActionResult<T = unknown> = {
  kind: AdminActionResultKind;
  value?: T;
  errorMessage?: string;
  error?: unknown;
  attemptedAt: number;
};

const extractStatusCode = (error: unknown): number | undefined => {
  const boom = error as Boom | undefined;
  if (boom?.output?.statusCode) return boom.output.statusCode;
  const status = (error as any)?.status ?? (error as any)?.statusCode;
  return typeof status === "number" ? status : undefined;
};

export const normalizeAdminActionError = (error: unknown): { kind: AdminActionResultKind; message: string } => {
  const message = (error as any)?.message ?? "unknown error";
  const statusCode = extractStatusCode(error);
  const lower = String(message).toLowerCase();

  if (statusCode === 401) return { kind: "failed_not_authorized", message };
  if (statusCode === 403) return { kind: "failed_not_admin", message };
  if (lower.includes("not admin") || lower.includes("not an admin") || lower.includes("not-admin"))
    return { kind: "failed_not_admin", message };
  if (lower.includes("not authorized") || lower.includes("not-authorized") || lower.includes("forbidden"))
    return { kind: "failed_not_authorized", message };
  if (lower.includes("metadata") || lower.includes("timed out") || lower.includes("unavailable"))
    return { kind: "failed_metadata_unavailable", message };

  return { kind: "failed_unknown", message };
};

export const attemptGroupAdminAction = async <T>(input: {
  actionName: string;
  groupJid: string;
  run: () => Promise<T>;
}): Promise<AdminActionResult<T>> => {
  const attemptedAt = Date.now();
  try {
    const value = await input.run();
    return { kind: "success", value, attemptedAt };
  } catch (error) {
    const normalized = normalizeAdminActionError(error);
    return { kind: normalized.kind, value: undefined, errorMessage: normalized.message, error, attemptedAt };
  }
};

export const refreshGroupMetadataAfterAction = async <T>(input: {
  actionName: string;
  refresh: () => Promise<T>;
}): Promise<AdminActionResult<T>> => attemptGroupAdminAction({ actionName: input.actionName, groupJid: "", run: input.refresh });
