export const normalizeJid = (jid?: string | null): string => {
  if (!jid) return "";
  const [userWithDevice, server] = jid.split("@");
  if (!server) return jid;
  const user = userWithDevice.includes(":") ? userWithDevice.split(":")[0] : userWithDevice;
  const normalizedServer = server === "c.us" ? "s.whatsapp.net" : server;
  return `${user}@${normalizedServer}`;
};

export const stripUser = (jid?: string | null): string => {
  if (!jid) return "";
  const normalized = normalizeJid(jid);
  const [user] = normalized.split("@");
  return user ?? normalized;
};

export const normalizeLidJid = (jid?: string | null): string | null => {
  if (!jid) return null;
  const normalized = normalizeJid(jid);
  return normalized.endsWith("@lid") ? normalized : null;
};

export const jidMatchesBot = (candidate: string | undefined, botAlias?: string): boolean => {
  if (!candidate || !botAlias) return false;
  const normalized = normalizeJid(candidate);
  const normalizedAlias = normalizeJid(botAlias);
  if (normalized === normalizedAlias) return true;
  return stripUser(normalized) === stripUser(normalizedAlias);
};

export const buildBotAliases = (input: { pnJid?: string | null; lidJid?: string | null }): string[] => {
  const aliases = new Set<string>();
  const add = (value?: string | null) => {
    if (value && value.trim()) aliases.add(value.trim());
  };

  if (input.pnJid) {
    const pnNormalized = normalizeJid(input.pnJid);
    add(input.pnJid);
    add(pnNormalized);
    add(stripUser(pnNormalized));
  }

  if (input.lidJid) {
    const lidNormalized = normalizeJid(input.lidJid);
    add(lidNormalized);
    add(stripUser(lidNormalized));
  }

  return Array.from(aliases).filter(Boolean);
};
