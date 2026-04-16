import {
  createCommandRegistry,
  resolveGovernanceDecision,
  type DecisionResult,
  type GovernancePort,
  type InboundMessageEvent,
  type RelationshipProfile
} from "@zappy/core";

interface GovernanceLogger {
  info: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
}

interface GovernanceRuntimeDeps {
  governancePort: GovernancePort;
  logger: GovernanceLogger;
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  commandPrefix: string;
  consentTermsVersion: string;
  freeDirectChatLimit?: number;
  enforcementEnabled: boolean;
  shadowEnabled: boolean;
}

interface GovernanceShadowDeps {
  governancePort: GovernancePort;
  logger: GovernanceLogger;
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  commandPrefix: string;
  enabled: boolean;
  consentTermsVersion: string;
}

interface GovernanceRuntimeInput {
  event: InboundMessageEvent;
  text: string;
  permissionRole?: string | null;
  relationshipProfile?: RelationshipProfile | null;
}

export interface GovernanceRuntimeEvaluationResult {
  evaluated: boolean;
  blocked: boolean;
  denyText?: string;
  capability?: string;
  route?: string;
  decision?: DecisionResult;
}

const PRIVILEGED_PROFILES = new Set<RelationshipProfile>(["creator_root", "mother_privileged", "delegated_owner"]);

const isPrivilegedProfile = (profile?: RelationshipProfile | null): boolean => {
  if (!profile) return false;
  return PRIVILEGED_PROFILES.has(profile);
};

const resolveCommandCapability = (input: { commandName: string; explicitCapability?: string }): string => {
  const explicit = input.explicitCapability?.trim().toLowerCase();
  if (explicit) return explicit;

  const normalized = input.commandName.trim().toLowerCase();
  const suffix = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `command.${suffix || "unknown"}`;
};

const resolveCapabilityFromEvent = (input: { event: InboundMessageEvent; text: string; registry: ReturnType<typeof createCommandRegistry> }) => {
  const command = input.registry.resolve(input.text);
  if (command) {
    return {
      capability: resolveCommandCapability({
        commandName: command.command.name,
        explicitCapability: command.command.capability
      }),
      commandName: command.command.name,
      requiredRole: command.command.requiredRole,
      requiresBotAdmin: command.command.botAdminRequired,
      requiresGroupAdmin: command.command.requiredRole === "group_admin",
      route: "command_registry"
    };
  }

  const messageType = (input.event.rawMessageType ?? "").toLowerCase();
  if (!input.text && input.event.hasMedia) {
    if (messageType.includes("audio")) return { capability: "command.transcribe", route: "media_audio" };
    if (messageType.includes("video") || messageType.includes("image")) {
      return { capability: input.event.isGroup ? "conversation.group" : "conversation.direct", route: "media_message" };
    }
  }

  return {
    capability: input.event.isGroup ? "conversation.group" : "conversation.direct",
    route: "conversation"
  };
};

const isApplicableInteraction = (input: { event: InboundMessageEvent; text: string; registry: ReturnType<typeof createCommandRegistry> }): boolean => {
  if (!input.event.isGroup) return true;
  if (input.registry.resolve(input.text)) return true;
  if (input.event.isBotMentioned || input.event.isReplyToBot) return true;
  return false;
};

const pickPrimaryReason = (decision: DecisionResult): string | undefined => {
  if (decision.reasonCodes.includes("DENY_ACCESS_BLOCKED")) return "DENY_ACCESS_BLOCKED";
  if (decision.reasonCodes.includes("DENY_ACCESS_PENDING")) return "DENY_ACCESS_PENDING";
  if (decision.reasonCodes.includes("DENY_LICENSE_CAPABILITY")) return "DENY_LICENSE_CAPABILITY";
  if (decision.reasonCodes.includes("DENY_QUOTA_LIMIT")) return "DENY_QUOTA_LIMIT";
  return decision.reasonCodes.find((code) => code.startsWith("DENY_"));
};

const buildDenyText = (decision: DecisionResult): string => {
  const reason = pickPrimaryReason(decision);
  if (reason === "DENY_ACCESS_BLOCKED") {
    return "Seu acesso ao Zappy está bloqueado no momento. Fale com um administrador para revisão.";
  }
  if (reason === "DENY_ACCESS_PENDING") {
    return "Seu acesso ao Zappy ainda está pendente de aprovação. Aguarde a liberação de um administrador.";
  }
  if (reason === "DENY_LICENSE_CAPABILITY") {
    if (decision.capabilityPolicy.denySource === "explicit_override_deny") {
      return "Esse recurso foi bloqueado explicitamente por uma política administrativa.";
    }
    return "Seu plano atual não permite esse recurso. Peça um upgrade de licença para continuar.";
  }
  if (reason === "DENY_QUOTA_LIMIT") {
    const limit = decision.licensing.quota?.limit;
    if (limit && Number.isFinite(limit)) {
      return `Você atingiu o limite diário do plano FREE (${limit} mensagens diretas). Tente novamente amanhã ou peça upgrade de plano.`;
    }
    return "Você atingiu o limite diário do plano FREE para mensagens diretas. Tente novamente amanhã ou peça upgrade de plano.";
  }
  return "Esta ação não está disponível pelas políticas atuais.";
};

const logDecision = (deps: GovernanceRuntimeDeps, input: { result: DecisionResult; capability: string; route: string; event: InboundMessageEvent }) => {
  const scope = input.result.snapshot.scope;
  const primaryPolicySubject =
    scope === "group"
      ? { type: "group", id: input.result.snapshot.waGroupId ?? input.event.waGroupId ?? null }
      : { type: "user", id: input.result.snapshot.waUserId };
  const secondaryPolicySubject =
    scope === "group" ? { type: "user", id: input.result.snapshot.waUserId } : null;

  const basePayload = {
    tenantId: input.event.tenantId,
    waUserId: input.event.waUserId,
    waGroupId: input.event.waGroupId,
    waMessageId: input.event.waMessageId,
    executionId: input.event.executionId,
    capability: input.capability,
    route: input.route,
    decision: input.result.decision,
    blockedByPolicy: input.result.blockedByPolicy,
    primaryDenySource: input.result.primaryDenySource,
    reasonCodes: input.result.reasonCodes,
    capabilityPolicy: input.result.capabilityPolicy,
    contextScope: input.event.isGroup ? "group" : "direct",
    governanceScope: scope,
    primaryPolicySubject,
    secondaryPolicySubject,
    effectiveAccessSource: input.result.snapshot.access.effective.source,
    capabilityDecisionSource: input.result.capabilityPolicy.decisionSource,
    capabilityDenySource: input.result.capabilityPolicy.denySource,
    senderIsGroupAdmin: input.event.senderIsGroupAdmin,
    botIsGroupAdmin: input.event.botIsGroupAdmin,
    botAdminCheckFailed: input.event.botAdminCheckFailed,
    approvalState: input.result.approval.state,
    planId: input.result.licensing.planId,
    quota: input.result.licensing.quota
  };

  if (deps.shadowEnabled) {
    deps.logger.info(
      deps.withCategory("WA-IN", {
        status: "governance_shadow_decision_evaluated",
        shadowMode: true,
        ...basePayload
      }),
      "governance decision evaluated (shadow mode)"
    );
  }

  if (!deps.enforcementEnabled) return;

  deps.logger.info(
    deps.withCategory("WA-IN", {
      status: "governance_enforcement_applied",
      enforcementMode: "runtime",
      denied: input.result.decision === "deny",
      denyReasonCode: pickPrimaryReason(input.result),
      ...basePayload
    }),
    "governance enforcement decision applied"
  );
};

export const createGovernanceRuntimeEvaluator = (deps: GovernanceRuntimeDeps) => {
  const registry = createCommandRegistry(deps.commandPrefix);

  return async (input: GovernanceRuntimeInput): Promise<GovernanceRuntimeEvaluationResult> => {
    if (!deps.shadowEnabled && !deps.enforcementEnabled) {
      return { evaluated: false, blocked: false };
    }

    if (!isApplicableInteraction({ event: input.event, text: input.text, registry })) {
      return { evaluated: false, blocked: false };
    }

    const capability = resolveCapabilityFromEvent({
      event: input.event,
      text: input.text,
      registry
    });

    try {
      const decision = await resolveGovernanceDecision(deps.governancePort, {
        tenant: { id: input.event.tenantId },
        user: {
          waUserId: input.event.waUserId,
          permissionRole: input.permissionRole,
          relationshipProfile: input.relationshipProfile,
          isPrivileged: isPrivilegedProfile(input.relationshipProfile),
          senderIsGroupAdmin: input.event.senderIsGroupAdmin
        },
        group: input.event.waGroupId
          ? {
              waGroupId: input.event.waGroupId,
              name: input.event.groupName
            }
          : undefined,
        context: {
          scope: input.event.isGroup ? "group" : "private",
          isGroup: input.event.isGroup,
          routeKey: "messages.upsert"
        },
        consent: {
          termsVersion: deps.consentTermsVersion,
          required: false,
          bypass: true
        },
        request: {
          capability: capability.capability,
          commandName: capability.commandName,
          route: capability.route,
          requiredRole: capability.requiredRole,
          requiresBotAdmin: capability.requiresBotAdmin,
          requiresGroupAdmin: capability.requiresGroupAdmin
        },
        message: {
          waMessageId: input.event.waMessageId,
          kind: input.event.kind,
          rawMessageType: input.event.rawMessageType,
          ingressSource: input.event.ingressSource,
          isBotMentioned: input.event.isBotMentioned,
          isReplyToBot: input.event.isReplyToBot
        },
        runtimePolicySignals: {
          botIsGroupAdmin: input.event.botIsGroupAdmin,
          botAdminCheckFailed: input.event.botAdminCheckFailed,
          botAdminStatusSource: input.event.botAdminStatusSource,
          botAdminCheckError: input.event.botAdminCheckError,
          freeDirectChatLimit: deps.freeDirectChatLimit
        }
      });

      logDecision(deps, {
        result: decision,
        capability: capability.capability,
        route: capability.route,
        event: input.event
      });

      if (!deps.enforcementEnabled || decision.allow) {
        return {
          evaluated: true,
          blocked: false,
          capability: capability.capability,
          route: capability.route,
          decision
        };
      }

      return {
        evaluated: true,
        blocked: true,
        denyText: buildDenyText(decision),
        capability: capability.capability,
        route: capability.route,
        decision
      };
    } catch (error) {
      deps.logger.warn?.(
        deps.withCategory("WARN", {
          status: "governance_runtime_decision_failed",
          enforcementEnabled: deps.enforcementEnabled,
          shadowEnabled: deps.shadowEnabled,
          tenantId: input.event.tenantId,
          waUserId: input.event.waUserId,
          waGroupId: input.event.waGroupId,
          waMessageId: input.event.waMessageId,
          executionId: input.event.executionId,
          capability: capability.capability,
          route: capability.route,
          error
        }),
        "governance decision runtime evaluation failed"
      );
      return { evaluated: false, blocked: false };
    }
  };
};

export const createGovernanceShadowEvaluator = (deps: GovernanceShadowDeps) => {
  const evaluate = createGovernanceRuntimeEvaluator({
    governancePort: deps.governancePort,
    logger: deps.logger,
    withCategory: deps.withCategory,
    commandPrefix: deps.commandPrefix,
    consentTermsVersion: deps.consentTermsVersion,
    freeDirectChatLimit: undefined,
    shadowEnabled: deps.enabled,
    enforcementEnabled: false
  });

  return async (input: GovernanceRuntimeInput): Promise<void> => {
    await evaluate(input);
  };
};
