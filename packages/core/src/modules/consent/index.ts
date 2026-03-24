export { checkConsentGate } from "./application/use-cases/check-consent-gate.js";
export { enforceConsent } from "./application/use-cases/enforce-consent.js";
export { acceptConsent } from "./application/use-cases/accept-consent.js";
export { declineConsent } from "./application/use-cases/decline-consent.js";
export { shouldBypassConsent } from "./application/policies/consent-bypass-policy.js";
export type { ConsentPort, ConversationStatePort, AuditPort, MetricsPort, LoggerPort } from "./ports.js";
