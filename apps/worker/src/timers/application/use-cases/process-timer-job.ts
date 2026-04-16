import {
  getTimerDispatchById,
  markTimerMessage,
  persistOutboundMessage,
  updateTimerStatus
} from "@zappy/adapters";
import { TimerStatus } from "@prisma/client";
import { resolveGovernanceDecision, type GovernancePort } from "@zappy/core";
import { withCategory } from "@zappy/shared";
import type { WaGatewayDispatchClient } from "../../../infrastructure/wa-gateway-dispatch-client.js";
import { resolveAsyncJobRecipient } from "../../../infrastructure/recipient-resolution.js";

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export interface TimerJobDeps {
  logger: LoggerLike;
  gatewayClient: WaGatewayDispatchClient;
  governancePort?: GovernancePort;
}

export const processTimerJob = async (timerId: string, deps: TimerJobDeps): Promise<void> => {
  const timer = await getTimerDispatchById(timerId);
  if (!timer) return;
  if (timer.status !== TimerStatus.SCHEDULED) {
    deps.logger.info(withCategory("QUEUE", { timerId, status: timer.status }), "timer already processed");
    return;
  }

  const recipient = resolveAsyncJobRecipient({
    waGroupId: timer.waGroupId,
    waUserId: timer.waUserId,
    pnJid: timer.user?.pnJid,
    lidJid: timer.user?.lidJid,
    phoneNumber: timer.user?.phoneNumber
  });

  const label = timer.label ? ` (${timer.label})` : "";
  const text = `⏱ Timer finalizado${label}`;
  const tenantId = timer.tenantId ?? "";
  const logContext = {
    tenantId,
    action: "fire_timer",
    referenceId: timer.id,
    originalRecipient: recipient.originalRecipient,
    resolvedRecipient: recipient.resolvedRecipient,
    recipientSource: recipient.recipientSource
  };

  try {
    if (!recipient.resolvedRecipient) throw new Error("Timer has no recipient");

    if (deps.governancePort) {
      const governanceWaUserId =
        timer.waUserId ?? (recipient.resolvedRecipient && !recipient.resolvedRecipient.endsWith("@g.us") ? recipient.resolvedRecipient : "unknown@s.whatsapp.net");
      const governanceDecision = await resolveGovernanceDecision(deps.governancePort, {
        tenant: { id: tenantId },
        user: { waUserId: governanceWaUserId },
        group: timer.waGroupId
          ? {
              waGroupId: timer.waGroupId
            }
          : undefined,
        context: {
          scope: timer.waGroupId ? "group" : "private",
          isGroup: Boolean(timer.waGroupId),
          routeKey: "worker.fire_timer"
        },
        consent: {
          bypass: true,
          required: false
        },
        request: {
          capability: timer.waGroupId ? "conversation.group" : "conversation.direct",
          route: "worker.fire_timer"
        },
        runtimePolicySignals: {
          source: "worker",
          jobType: "fire-timer",
          skipQuotaConsumption: true
        }
      });

      if (!governanceDecision.allow) {
        deps.logger.warn?.(
          withCategory("WARN", {
            action: "fire_timer",
            status: "worker_governance_execution_denied",
            tenantId,
            timerId: timer.id,
            waUserId: governanceWaUserId,
            waGroupId: timer.waGroupId ?? undefined,
            reasonCodes: governanceDecision.reasonCodes,
            approvalState: governanceDecision.approval.state,
            planId: governanceDecision.licensing.planId,
            quota: governanceDecision.licensing.quota
          }),
          "worker timer execution denied by current policy"
        );
        throw new Error(`worker_governance_execution_denied:${governanceDecision.reasonCodes.join(",") || "unknown"}`);
      }
    }

    deps.logger.info(withCategory("WA-OUT", { ...logContext, waMessageId: null }), "dispatching timer");

    // Keep async deliveries transport-agnostic by calling the gateway internal API.
    const sent = await deps.gatewayClient.sendText({
      tenantId,
      to: recipient.resolvedRecipient,
      text,
      action: "fire_timer",
      referenceId: timer.id,
      waUserId: timer.waUserId ?? undefined,
      waGroupId: timer.waGroupId ?? undefined
    });

    await updateTimerStatus(timer.id, TimerStatus.FIRED);
    await markTimerMessage({ timerId: timer.id, messageId: sent.waMessageId });

    await persistOutboundMessage({
      tenantId,
      userId: timer.userId ?? undefined,
      groupId: timer.groupId ?? undefined,
      waUserId: timer.waUserId ?? recipient.resolvedRecipient,
      waGroupId: timer.waGroupId ?? undefined,
      text,
      waMessageId: sent.waMessageId,
      rawJson: sent.raw
    });

    deps.logger.info(withCategory("WA-OUT", { ...logContext, waMessageId: sent.waMessageId }), "timer delivered");
  } catch (error) {
    await updateTimerStatus(timer.id, TimerStatus.FAILED);
    deps.logger.error(withCategory("ERROR", { ...logContext, waMessageId: null, error }), "failed to process timer");
    throw error;
  }
};
