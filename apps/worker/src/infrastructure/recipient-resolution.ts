export type AsyncJobRecipientSource = "waGroupId" | "pnJid" | "lidJid" | "waUserId" | "phoneNumber" | "none";

export interface ResolveAsyncJobRecipientInput {
  waGroupId?: string | null;
  waUserId?: string | null;
  pnJid?: string | null;
  lidJid?: string | null;
  phoneNumber?: string | null;
}

export interface AsyncJobRecipientResolution {
  scope: "group" | "direct";
  originalRecipient: string | null;
  resolvedRecipient: string | null;
  recipientSource: AsyncJobRecipientSource;
}

const normalizeString = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const normalizePhoneToJid = (phoneNumber?: string | null): string | null => {
  const digits = normalizeString(phoneNumber)?.replace(/\D/g, "");
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
};

export const resolveAsyncJobRecipient = (input: ResolveAsyncJobRecipientInput): AsyncJobRecipientResolution => {
  const waGroupId = normalizeString(input.waGroupId);
  if (waGroupId) {
    return {
      scope: "group",
      originalRecipient: waGroupId,
      resolvedRecipient: waGroupId,
      recipientSource: "waGroupId"
    };
  }

  const originalRecipient = normalizeString(input.waUserId) ?? normalizeString(input.phoneNumber) ?? null;
  const candidates: Array<{ source: AsyncJobRecipientSource; value: string | null }> = [
    { source: "pnJid", value: normalizeString(input.pnJid) },
    { source: "lidJid", value: normalizeString(input.lidJid) },
    { source: "waUserId", value: normalizeString(input.waUserId) },
    { source: "phoneNumber", value: normalizePhoneToJid(input.phoneNumber) }
  ];

  const matched = candidates.find((entry) => entry.value);
  if (!matched) {
    return {
      scope: "direct",
      originalRecipient,
      resolvedRecipient: null,
      recipientSource: "none"
    };
  }

  return {
    scope: "direct",
    originalRecipient,
    resolvedRecipient: matched.value,
    recipientSource: matched.source
  };
};
