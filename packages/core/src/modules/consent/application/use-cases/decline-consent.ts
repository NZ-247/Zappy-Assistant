import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { ConversationStateRecord, UserConsentRecord } from "../../../../pipeline/types.js";
import type { AuditPort, ConsentPort, ConversationStatePort, LoggerPort } from "../../ports/consent.port.js";
import { safeRecordAudit } from "../services/consent-instrumentation.js";

export interface DeclineConsentInput {
  consentPort: ConsentPort;
  conversationState?: ConversationStatePort;
  audit?: AuditPort;
  logger?: LoggerPort;
  tenantId: string;
  waUserId: string;
  waGroupId?: string;
  consentVersion: string;
  consentSource: string;
  now: Date;
  replyText: string;
  pendingStateTtlMs: number;
}

export interface DeclineConsentResult {
  consent: UserConsentRecord;
  actions: ResponseAction[];
  nextConversationState: ConversationStateRecord;
  consentRequired: boolean;
}

export const declineConsent = async (input: DeclineConsentInput): Promise<DeclineConsentResult> => {
  const {
    consentPort,
    conversationState,
    audit,
    logger,
    tenantId,
    waUserId,
    waGroupId,
    consentVersion,
    consentSource,
    now,
    replyText,
    pendingStateTtlMs
  } = input;

  const consent = await consentPort.setConsentStatus({
    tenantId,
    waUserId,
    status: "DECLINED",
    termsVersion: consentVersion,
    source: consentSource,
    timestamp: now
  });

  await safeRecordAudit(audit, logger, {
    kind: "consent",
    tenantId,
    waUserId,
    waGroupId,
    status: "DECLINED",
    version: consentVersion
  });

  // Decline should keep the gate closed; no metric change in current behavior.
  const expiresAt = new Date(now.getTime() + pendingStateTtlMs);
  if (conversationState) {
    await conversationState.setState({
      tenantId,
      waGroupId,
      waUserId,
      state: "WAITING_CONSENT",
      context: { termsVersion: consentVersion },
      expiresAt
    });
  }

  const nextConversationState: ConversationStateRecord = {
    state: "WAITING_CONSENT",
    context: { termsVersion: consentVersion },
    updatedAt: now,
    expiresAt
  };

  return {
    consent,
    actions: [{ kind: "reply_text", text: replyText }],
    nextConversationState,
    consentRequired: true
  };
};
