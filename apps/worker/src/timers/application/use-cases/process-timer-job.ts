import {
  getTimerDispatchById,
  markTimerMessage,
  persistOutboundMessage,
  updateTimerStatus
} from "@zappy/adapters";
import { TimerStatus } from "@prisma/client";
import { withCategory } from "@zappy/shared";
import type { WaGatewayDispatchClient } from "../../../infrastructure/wa-gateway-dispatch-client.js";
import { resolveAsyncJobRecipient } from "../../../infrastructure/recipient-resolution.js";

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export interface TimerJobDeps {
  logger: LoggerLike;
  gatewayClient: WaGatewayDispatchClient;
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
