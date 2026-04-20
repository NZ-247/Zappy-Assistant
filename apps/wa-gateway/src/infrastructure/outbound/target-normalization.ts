import { normalizeWhatsAppDirectTarget, normalizeWhatsAppGroupTarget } from "@zappy/shared";

export interface OutboundTargetResolution {
  requestedTo: string;
  normalizedTo: string;
  scope: "group" | "direct";
  normalizationApplied: boolean;
}

export const resolveOutboundTarget = (requestedTo: string): OutboundTargetResolution => {
  const normalizedGroup = normalizeWhatsAppGroupTarget(requestedTo);
  if (normalizedGroup) {
    return {
      requestedTo,
      normalizedTo: normalizedGroup,
      scope: "group",
      normalizationApplied: normalizedGroup !== requestedTo
    };
  }

  const normalizedDirect = normalizeWhatsAppDirectTarget(requestedTo);
  if (normalizedDirect) {
    return {
      requestedTo,
      normalizedTo: normalizedDirect,
      scope: "direct",
      normalizationApplied: normalizedDirect !== requestedTo
    };
  }

  return {
    requestedTo,
    normalizedTo: requestedTo,
    scope: requestedTo.endsWith("@g.us") ? "group" : "direct",
    normalizationApplied: false
  };
};
