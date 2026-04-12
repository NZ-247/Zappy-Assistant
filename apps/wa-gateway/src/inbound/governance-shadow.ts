import {
  createCommandRegistry,
  resolveGovernanceDecision,
  type GovernancePort,
  type InboundMessageEvent,
  type RelationshipProfile
} from "@zappy/core";

interface GovernanceShadowLogger {
  info: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
}

interface GovernanceShadowDeps {
  governancePort: GovernancePort;
  logger: GovernanceShadowLogger;
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  commandPrefix: string;
  enabled: boolean;
  consentTermsVersion: string;
}

interface GovernanceShadowInput {
  event: InboundMessageEvent;
  text: string;
  permissionRole?: string | null;
  relationshipProfile?: RelationshipProfile | null;
}

const PRIVILEGED_PROFILES = new Set<RelationshipProfile>(["creator_root", "mother_privileged", "delegated_owner"]);

const isPrivilegedProfile = (profile?: RelationshipProfile | null): boolean => {
  if (!profile) return false;
  return PRIVILEGED_PROFILES.has(profile);
};

const resolveCapabilityFromEvent = (input: { event: InboundMessageEvent; text: string; registry: ReturnType<typeof createCommandRegistry> }) => {
  const registry = input.registry;
  const command = registry.resolve(input.text);
  if (command) {
    return {
      capability: `command.${command.command.name}`,
      commandName: command.command.name,
      requiredRole: command.command.requiredRole,
      requiresBotAdmin: command.command.botAdminRequired,
      requiresGroupAdmin: command.command.requiredRole === "group_admin",
      route: "command_registry"
    };
  }

  const messageType = (input.event.rawMessageType ?? "").toLowerCase();
  if (!input.text && input.event.hasMedia) {
    if (messageType.includes("audio")) return { capability: "audio.transcribe", route: "media_audio" };
    if (messageType.includes("video") || messageType.includes("image")) return { capability: "media.message", route: "media_message" };
  }

  return {
    capability: input.event.isGroup ? "conversation.group" : "conversation.direct",
    route: "conversation"
  };
};

export const createGovernanceShadowEvaluator = (deps: GovernanceShadowDeps) => {
  const registry = createCommandRegistry(deps.commandPrefix);

  return async (input: GovernanceShadowInput): Promise<void> => {
    if (!deps.enabled) return;

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
          required: !input.event.isGroup
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
          botAdminCheckError: input.event.botAdminCheckError
        }
      });

      deps.logger.info(
        deps.withCategory("WA-IN", {
          status: "governance_shadow_decision_evaluated",
          shadowMode: true,
          tenantId: input.event.tenantId,
          waUserId: input.event.waUserId,
          waGroupId: input.event.waGroupId,
          waMessageId: input.event.waMessageId,
          executionId: input.event.executionId,
          capability: capability.capability,
          route: capability.route,
          decision: decision.decision,
          blockedByPolicy: decision.blockedByPolicy,
          reasonCodes: decision.reasonCodes,
          contextScope: input.event.isGroup ? "group" : "direct",
          senderIsGroupAdmin: input.event.senderIsGroupAdmin,
          botIsGroupAdmin: input.event.botIsGroupAdmin,
          botAdminCheckFailed: input.event.botAdminCheckFailed
        }),
        "governance decision evaluated (shadow mode)"
      );
    } catch (error) {
      deps.logger.warn?.(
        deps.withCategory("WARN", {
          status: "governance_shadow_decision_failed",
          shadowMode: true,
          tenantId: input.event.tenantId,
          waUserId: input.event.waUserId,
          waGroupId: input.event.waGroupId,
          waMessageId: input.event.waMessageId,
          executionId: input.event.executionId,
          error
        }),
        "governance decision shadow evaluation failed"
      );
    }
  };
};
