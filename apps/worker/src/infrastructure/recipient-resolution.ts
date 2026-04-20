import { hasExplicitJidDomain, normalizeWhatsAppDirectTarget, normalizeWhatsAppGroupTarget } from "@zappy/shared";

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

export const resolveAsyncJobRecipient = (input: ResolveAsyncJobRecipientInput): AsyncJobRecipientResolution => {
  const waGroupId = normalizeWhatsAppGroupTarget(input.waGroupId) ?? normalizeString(input.waGroupId);
  if (waGroupId) {
    return {
      scope: "group",
      originalRecipient: waGroupId,
      resolvedRecipient: waGroupId,
      recipientSource: "waGroupId"
    };
  }

  const originalRecipient = normalizeString(input.waUserId) ?? normalizeString(input.phoneNumber) ?? null;
  const normalizedWaUserId = normalizeString(input.waUserId);
  const waUserIdHasDomain = hasExplicitJidDomain(normalizedWaUserId);
  const candidates: Array<{ source: AsyncJobRecipientSource; value: string | null }> = [
    { source: "waUserId", value: waUserIdHasDomain ? normalizeWhatsAppDirectTarget(normalizedWaUserId) : null },
    { source: "lidJid", value: normalizeWhatsAppDirectTarget(input.lidJid) },
    { source: "pnJid", value: normalizeWhatsAppDirectTarget(input.pnJid) },
    { source: "waUserId", value: !waUserIdHasDomain ? normalizeWhatsAppDirectTarget(normalizedWaUserId) : null },
    { source: "phoneNumber", value: normalizeWhatsAppDirectTarget(input.phoneNumber) }
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
