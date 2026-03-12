import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { ConversationStateRecord, UserConsentRecord } from "../../../../pipeline/types.js";
import type { PipelineContext } from "../../../../pipeline/context.js";
import type {
  AuditPort,
  ConsentPort,
  ConversationStatePort,
  LoggerPort,
  MetricsPort
} from "../../ports/consent.port.js";
import { ensureConsentPending } from "./ensure-consent-pending.js";
import { acceptConsent } from "./accept-consent.js";
import { declineConsent } from "./decline-consent.js";
import {
  buildConsentAcceptedText,
  buildConsentOnboardingText,
  buildConsentReminderText,
  normalizeConsentInput
} from "../services/consent-texts.js";

export interface EnforceConsentDeps {
  consentPort: ConsentPort;
  conversationState?: ConversationStatePort;
  audit?: AuditPort;
  metrics?: MetricsPort;
  logger?: LoggerPort;
  consentLink: string;
  consentVersion: string;
  consentSource: string;
  commandPrefix: string;
  pendingStateTtlMs: number;
  now: Date;
  stylizeReply: (text: string, options?: { suggestNext?: string }) => string;
}

export interface EnforceConsentResult {
  actions: ResponseAction[];
  consent?: UserConsentRecord | null;
  consentRequired?: boolean;
  conversationState?: ConversationStateRecord;
}

const wantsTerms = (normalizedInput: string): boolean =>
  normalizedInput.includes("terms") || normalizedInput.includes("termos") || normalizedInput.includes("politica") || normalizedInput.includes("politics");

export const enforceConsent = async (ctx: PipelineContext, deps: EnforceConsentDeps): Promise<EnforceConsentResult> => {
  if (ctx.bypassConsent) return { actions: [] };

  const needsConsent = ctx.consentRequired || ctx.classification.kind === "consent_pending";
  if (!needsConsent) return { actions: [] };

  const normalized = normalizeConsentInput(ctx.event.normalizedText);
  const isYes = /^sim\b/.test(normalized) || normalized === "yes";
  const isNo = /^(nao\b|nao aceito|nao quero|nao concordo)/.test(normalized);
  const wantsHelp = normalized === "ajuda" || normalized === "help" || normalized === deps.commandPrefix.toLowerCase() + "help" || normalized === deps.commandPrefix.toLowerCase() + "ajuda";

  const ensurePendingResult = async () => {
    return ensureConsentPending({
      consentPort: deps.consentPort,
      conversationState: deps.conversationState,
      audit: deps.audit,
      metrics: deps.metrics,
      logger: deps.logger,
      consentVersion: deps.consentVersion,
      consentSource: deps.consentSource,
      tenantId: ctx.event.tenantId,
      waUserId: ctx.event.waUserId,
      waGroupId: ctx.event.waGroupId,
      now: deps.now,
      currentConsent: ctx.consent,
      pendingStateTtlMs: deps.pendingStateTtlMs
    });
  };

  if (isYes) {
    const accepted = await acceptConsent({
      consentPort: deps.consentPort,
      conversationState: deps.conversationState,
      audit: deps.audit,
      metrics: deps.metrics,
      logger: deps.logger,
      tenantId: ctx.event.tenantId,
      waUserId: ctx.event.waUserId,
      waGroupId: ctx.event.waGroupId,
      consentVersion: deps.consentVersion,
      consentSource: deps.consentSource,
      now: deps.now,
      replyText: deps.stylizeReply(buildConsentAcceptedText(), { suggestNext: "organizar suporte, orçamento, agendamento ou dúvidas" })
    });
    return {
      actions: accepted.actions,
      consent: accepted.consent,
      consentRequired: accepted.consentRequired,
      conversationState: accepted.nextConversationState
    };
  }

  if (isNo) {
    const declined = await declineConsent({
      consentPort: deps.consentPort,
      conversationState: deps.conversationState,
      audit: deps.audit,
      logger: deps.logger,
      tenantId: ctx.event.tenantId,
      waUserId: ctx.event.waUserId,
      waGroupId: ctx.event.waGroupId,
      consentVersion: deps.consentVersion,
      consentSource: deps.consentSource,
      now: deps.now,
      replyText: deps.stylizeReply(
        `Entendido. Não vou prosseguir sem seu consentimento. Se mudar de ideia, envie SIM após ler: ${deps.consentLink}.`
      ),
      pendingStateTtlMs: deps.pendingStateTtlMs
    });
    return {
      actions: declined.actions,
      consent: declined.consent,
      consentRequired: declined.consentRequired,
      conversationState: declined.nextConversationState
    };
  }

  if (wantsTerms(normalized)) {
    const pending = await ensurePendingResult();
    return {
      actions: [
        {
          kind: "reply_text",
          text: deps.stylizeReply(
            `Termos de Compromisso e Política de Privacidade: ${deps.consentLink}. Responda SIM para aceitar ou NÃO para recusar.`
          )
        }
      ],
      consent: pending.consent ?? ctx.consent,
      consentRequired: true,
      conversationState: pending.conversationState
    };
  }

  if (wantsHelp) {
    const pending = await ensurePendingResult();
    return {
      actions: [{ kind: "reply_text", text: deps.stylizeReply(buildConsentReminderText(deps.consentLink)) }],
      consent: pending.consent ?? ctx.consent,
      consentRequired: true,
      conversationState: pending.conversationState
    };
  }

  const pending = await ensurePendingResult();
  const nextConversationState = pending.conversationState ?? ctx.conversationState;
  const message =
    nextConversationState.state === "WAITING_CONSENT"
      ? buildConsentReminderText(deps.consentLink)
      : buildConsentOnboardingText(deps.consentLink);

  return {
    actions: [{ kind: "reply_text", text: deps.stylizeReply(message) }],
    consent: pending.consent ?? ctx.consent,
    consentRequired: true,
    conversationState: nextConversationState
  };
};
