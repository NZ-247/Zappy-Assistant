import type { ConversationStateRecord, RelationshipProfile, UserConsentRecord } from "../../../../pipeline/types.js";
import { shouldBypassConsent } from "../policies/consent-bypass-policy.js";

export interface CheckConsentGateInput {
  consent?: UserConsentRecord | null;
  consentVersion: string;
  permissionRole?: string | null;
  role?: string | null;
  relationshipProfile: RelationshipProfile;
  conversationState?: ConversationStateRecord;
}

export interface CheckConsentGateResult {
  bypassConsent: boolean;
  consentRequired: boolean;
  shouldClearConversationState: boolean;
}

export const checkConsentGate = (input: CheckConsentGateInput): CheckConsentGateResult => {
  const bypassConsent = shouldBypassConsent({
    permissionRole: input.permissionRole,
    role: input.role,
    relationshipProfile: input.relationshipProfile
  });

  const consentRequired =
    !bypassConsent &&
    (!input.consent || input.consent.termsVersion !== input.consentVersion || input.consent.status !== "ACCEPTED");

  const shouldClearConversationState =
    !consentRequired && input.conversationState?.state === "WAITING_CONSENT";

  return {
    bypassConsent,
    consentRequired,
    shouldClearConversationState
  };
};
