import {
  getReminderDispatchById,
  markReminderMessage,
  persistOutboundMessage,
  updateReminderStatus
} from "@zappy/adapters";
import { ReminderStatus } from "@prisma/client";
import { withCategory } from "@zappy/shared";
import type { WaGatewayDispatchClient } from "../../../infrastructure/wa-gateway-dispatch-client.js";
import { resolveAsyncJobRecipient } from "../../../infrastructure/recipient-resolution.js";

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export interface ReminderJobDeps {
  logger: LoggerLike;
  gatewayClient: WaGatewayDispatchClient;
  metrics: { increment: (metric: "reminders_sent_total", by?: number) => Promise<void> };
  auditTrail: {
    record: (input: {
      kind: "reminder";
      tenantId: string;
      waUserId: string;
      waGroupId?: string;
      reminderId: string;
      status: "scheduled" | "sent" | "failed";
      message?: string;
      actor?: string;
    }) => Promise<void>;
  };
}

export const processReminderJob = async (reminderId: string, deps: ReminderJobDeps): Promise<void> => {
  const reminder = await getReminderDispatchById(reminderId);
  if (!reminder) return;
  if (reminder.status !== ReminderStatus.SCHEDULED) {
    deps.logger.info(
      withCategory("QUEUE", { reminderId, reminderPublicId: reminder.publicId ?? reminder.id, status: reminder.status }),
      "reminder already processed"
    );
    return;
  }

  const recipient = resolveAsyncJobRecipient({
    waGroupId: reminder.waGroupId,
    waUserId: reminder.waUserId,
    pnJid: reminder.user?.pnJid,
    lidJid: reminder.user?.lidJid,
    phoneNumber: reminder.user?.phoneNumber
  });

  const referenceId = reminder.publicId ?? reminder.id;
  const text = `⏰ Lembrete: ${reminder.message}`;
  const tenantId = reminder.tenantId ?? "";
  const logContext = {
    tenantId,
    action: "send_reminder",
    referenceId,
    originalRecipient: recipient.originalRecipient,
    resolvedRecipient: recipient.resolvedRecipient,
    recipientSource: recipient.recipientSource
  };

  try {
    if (!recipient.resolvedRecipient) throw new Error("Reminder has no recipient");
    deps.logger.info(withCategory("WA-OUT", { ...logContext, waMessageId: null }), "dispatching reminder");

    // Worker does not speak to Baileys directly; it dispatches via the internal gateway API.
    const sent = await deps.gatewayClient.sendText({
      tenantId,
      to: recipient.resolvedRecipient,
      text,
      action: "send_reminder",
      referenceId,
      waUserId: reminder.waUserId ?? undefined,
      waGroupId: reminder.waGroupId ?? undefined
    });

    await updateReminderStatus(reminder.id, ReminderStatus.SENT);
    await markReminderMessage({ reminderId: reminder.id, messageId: sent.waMessageId });

    const outboundWaUserId = reminder.waUserId ?? recipient.resolvedRecipient;
    await persistOutboundMessage({
      tenantId,
      userId: reminder.userId ?? undefined,
      groupId: reminder.groupId ?? undefined,
      waUserId: outboundWaUserId,
      waGroupId: reminder.waGroupId ?? undefined,
      text,
      waMessageId: sent.waMessageId,
      rawJson: sent.raw
    });

    await deps.metrics.increment("reminders_sent_total");
    await deps.auditTrail.record({
      kind: "reminder",
      tenantId,
      waUserId: outboundWaUserId,
      waGroupId: reminder.waGroupId ?? undefined,
      reminderId: reminder.id,
      status: "sent",
      message: reminder.message
    });

    deps.logger.info(withCategory("WA-OUT", { ...logContext, waMessageId: sent.waMessageId }), "reminder delivered");
  } catch (error) {
    await updateReminderStatus(reminder.id, ReminderStatus.FAILED);

    const auditWaUserId = reminder.waUserId ?? recipient.resolvedRecipient ?? reminder.waGroupId ?? "unknown";
    await deps.auditTrail.record({
      kind: "reminder",
      tenantId,
      waUserId: auditWaUserId,
      waGroupId: reminder.waGroupId ?? undefined,
      reminderId: reminder.id,
      status: "failed",
      message: reminder.message
    });

    deps.logger.error(withCategory("ERROR", { ...logContext, waMessageId: null, error }), "failed to process reminder");
    throw error;
  }
};
