const INTERNAL_ROLE_LABELS = new Set([
  "root",
  "creator_root",
  "bot_admin",
  "group_admin",
  "admin",
  "owner",
  "dono",
  "privileged",
  "member",
  "membro",
  "creator",
  "internal"
]);

const sanitizeCandidate = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutAtPrefix = trimmed.replace(/^@+/, "").trim();
  if (!withoutAtPrefix) return null;
  return withoutAtPrefix;
};

const normalizeRoleToken = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const isInternalRoleLabel = (value?: string | null): boolean => {
  const sanitized = sanitizeCandidate(value);
  if (!sanitized) return false;
  const normalized = normalizeRoleToken(sanitized);
  if (INTERNAL_ROLE_LABELS.has(normalized)) return true;

  const tokenized = normalized.split("_").filter(Boolean);
  if (tokenized.length === 0) return false;
  return tokenized.every((token) => INTERNAL_ROLE_LABELS.has(token));
};

export const resolveSafeDisplayName = (input: {
  trustedProfileName?: string | null;
  friendlyName?: string | null;
  fallback?: string;
}): string => {
  const fallback = sanitizeCandidate(input.fallback) ?? "você";
  const candidates = [input.trustedProfileName, input.friendlyName];
  for (const candidate of candidates) {
    const sanitized = sanitizeCandidate(candidate);
    if (!sanitized) continue;
    if (isInternalRoleLabel(sanitized)) continue;
    return sanitized;
  }
  return fallback;
};
