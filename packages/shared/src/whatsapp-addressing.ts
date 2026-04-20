const normalizeString = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const normalizeWhatsAppJidLike = (value?: string | null): string | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  if (!normalized.includes("@")) {
    return normalized;
  }

  const [userWithDevice, serverRaw] = normalized.split("@");
  if (!userWithDevice || !serverRaw) return normalized;

  const user = userWithDevice.includes(":") ? userWithDevice.split(":")[0] : userWithDevice;
  const server = serverRaw === "c.us" ? "s.whatsapp.net" : serverRaw;
  return `${user}@${server}`;
};

export const normalizeWhatsAppDirectTarget = (value?: string | null): string | null => {
  const normalized = normalizeWhatsAppJidLike(value);
  if (!normalized) return null;
  if (normalized.endsWith("@g.us")) return null;
  if (normalized.includes("@")) return normalized;

  const digits = normalized.replace(/\D/g, "");
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
};

export const normalizeWhatsAppGroupTarget = (value?: string | null): string | null => {
  const normalized = normalizeWhatsAppJidLike(value);
  if (!normalized) return null;

  if (normalized.endsWith("@g.us")) return normalized;
  return null;
};

export const hasExplicitJidDomain = (value?: string | null): boolean => {
  const normalized = normalizeString(value);
  return Boolean(normalized && normalized.includes("@"));
};
