import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { ConversationStateRecord, UserConsentRecord } from "../../../../pipeline/types.js";
import type { AuditPort, ConsentPort, ConversationStatePort, LoggerPort, MetricsPort } from "../../ports/consent.port.js";
import { safeBumpMetric, safeRecordAudit } from "../services/consent-instrumentation.js";

export interface AcceptConsentInput {
  consentPort: ConsentPort;
  conversationState?: ConversationStatePort;
  audit?: AuditPort;
  metrics?: MetricsPort;
  logger?: LoggerPort;
  tenantId: string;
  waUserId: string;
  waGroupId?: string;
  consentVersion: string;
  consentSource: string;
  now: Date;
  replyText: string;
}

export interface AcceptConsentResult {
  consent: UserConsentRecord;
  actions: ResponseAction[];
  nextConversationState: ConversationStateRecord;
  consentRequired: boolean;
}

export const acceptConsent = async (input: AcceptConsentInput): Promise<AcceptConsentResult> => {
  const {
    consentPort,
    conversationState,
    audit,
    metrics,
    logger,
    tenantId,
    waUserId,
    waGroupId,
    consentVersion,
    consentSource,
    now,
    replyText
  } = input;

  const consent = await consentPort.setConsentStatus({
    tenantId,
    waUserId,
    status: "ACCEPTED",
    termsVersion: consentVersion,
    source: consentSource,
    timestamp: now
  });

  await safeRecordAudit(audit, logger, {
    kind: "consent",
    tenantId,
    waUserId,
    waGroupId,
    status: "ACCEPTED",
    version: consentVersion
  });
  await safeBumpMetric(metrics, logger, "onboarding_accepted_total");

  if (conversationState) {
    await conversationState.clearState({ tenantId, waGroupId, waUserId });
  }

  const nextConversationState: ConversationStateRecord = { state: "NONE", updatedAt: now };

  return {
    consent,
    actions: [{ kind: "reply_text", text: replyText }],
    nextConversationState,
    consentRequired: false
  };
};
