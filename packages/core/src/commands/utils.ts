export const DEFAULT_COMMAND_PREFIX = "/";

export const normalizeCommandPrefix = (value?: string | null): string => {
  const trimmed = (value ?? "").trim();
  return trimmed || DEFAULT_COMMAND_PREFIX;
};

export const hasCommandPrefix = (text: string, prefix: string): boolean => text.trim().startsWith(prefix);

export const stripCommandPrefix = (text: string, prefix: string): string => {
  const trimmed = text.trim();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
};

export const formatCommand = (prefix: string, body: string): string => {
  const cleaned = body.replace(/^\/+/, "").trim();
  return `${prefix}${cleaned}`;
};
