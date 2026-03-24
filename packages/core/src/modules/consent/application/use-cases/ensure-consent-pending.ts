import type { ConversationStateRecord, UserConsentRecord } from "../../../../pipeline/types.js";
import type { AuditPort, ConsentPort, ConversationStatePort, LoggerPort, MetricsPort } from "../../ports.js";
import { safeBumpMetric, safeRecordAudit } from "../services/consent-instrumentation.js";

export interface EnsureConsentPendingInput {
  consentPort: ConsentPort;
  conversationState?: ConversationStatePort;
  audit?: AuditPort;
  metrics?: MetricsPort;
  logger?: LoggerPort;
  consentVersion: string;
  consentSource: string;
  tenantId: string;
  waUserId: string;
  waGroupId?: string;
  now: Date;
  currentConsent?: UserConsentRecord | null;
  pendingStateTtlMs: number;
}

export interface EnsureConsentPendingResult {
  consent?: UserConsentRecord | null;
  conversationState: ConversationStateRecord;
}

const buildWaitingState = (now: Date, consentVersion: string, pendingStateTtlMs: number): ConversationStateRecord => {
  const expiresAt = new Date(now.getTime() + pendingStateTtlMs);
  return {
    state: "WAITING_CONSENT",
    context: { termsVersion: consentVersion },
    updatedAt: now,
    expiresAt
  };
};

export const ensureConsentPending = async (input: EnsureConsentPendingInput): Promise<EnsureConsentPendingResult> => {
  const { consentPort, conversationState, audit, metrics, logger, consentVersion, consentSource, tenantId, waUserId, waGroupId, now, pendingStateTtlMs } =
    input;

  const shouldSetPending =
    !input.currentConsent ||
    input.currentConsent.status !== "PENDING" ||
    input.currentConsent.termsVersion !== consentVersion;

  let consent = input.currentConsent;
  if (shouldSetPending) {
    consent = await consentPort.setConsentStatus({
      tenantId,
      waUserId,
      status: "PENDING",
      termsVersion: consentVersion,
      source: consentSource,
      timestamp: now
    });
    await safeRecordAudit(audit, logger, {
      kind: "consent",
      tenantId,
      waUserId,
      waGroupId,
      status: "PENDING",
      version: consentVersion
    });
    await safeBumpMetric(metrics, logger, "onboarding_pending_total");
  }

  const nextState = buildWaitingState(now, consentVersion, pendingStateTtlMs);
  if (conversationState) {
    const expiresAt = nextState.expiresAt ?? new Date(now.getTime() + pendingStateTtlMs);
    await conversationState.setState({
      tenantId,
      waGroupId,
      waUserId,
      state: "WAITING_CONSENT",
      context: nextState.context,
      expiresAt
    });
  }

  return { consent, conversationState: nextState };
};
