import {
  getReminderDispatchById,
  markReminderMessage,
  persistOutboundMessage,
  updateReminderStatus
} from "@zappy/adapters";
import { ReminderStatus } from "@prisma/client";
import { resolveGovernanceDecision, type GovernancePort } from "@zappy/core";
import { withCategory } from "@zappy/shared";
import type { WaGatewayDispatchClient } from "../../../infrastructure/wa-gateway-dispatch-client.js";
import { resolveAsyncJobRecipient } from "../../../infrastructure/recipient-resolution.js";

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

type ReminderProcessingStage =
  | "load_reminder"
  | "resolve_recipient"
  | "governance_check"
  | "dispatch_gateway"
  | "mark_sent_status"
  | "persist_outbound"
  | "metrics_audit";

export interface ReminderPersistencePort {
  getReminderDispatchById: typeof getReminderDispatchById;
  updateReminderStatus: typeof updateReminderStatus;
  markReminderMessage: typeof markReminderMessage;
  persistOutboundMessage: typeof persistOutboundMessage;
}

const defaultPersistence: ReminderPersistencePort = {
  getReminderDispatchById,
  updateReminderStatus,
  markReminderMessage,
  persistOutboundMessage
};

const compactInline = (value: string): string => value.replace(/\s+/g, " ").trim();

export const summarizeReminderJobError = (error: unknown): { errorName: string; operatorMessage: string } => {
  if (error instanceof Error) {
    const message = compactInline(error.message || "erro_desconhecido");
    return {
      errorName: error.name || "Error",
      operatorMessage: message.length <= 180 ? message : `${message.slice(0, 177)}...`
    };
  }
  const raw = compactInline(String(error ?? "erro_desconhecido"));
  return {
    errorName: "UnknownError",
    operatorMessage: raw.length <= 180 ? raw : `${raw.slice(0, 177)}...`
  };
};

const failureCategoryByStage = (stage: ReminderProcessingStage): string => {
  switch (stage) {
    case "load_reminder":
      return "reminder_lookup_failed";
    case "resolve_recipient":
      return "recipient_resolution_failed";
    case "governance_check":
      return "governance_execution_denied";
    case "dispatch_gateway":
      return "gateway_dispatch_failed";
    case "mark_sent_status":
      return "status_persistence_failed";
    case "persist_outbound":
      return "outbound_persistence_failed";
    case "metrics_audit":
      return "post_dispatch_observability_failed";
    default:
      return "reminder_processing_failed";
  }
};

export const buildReminderFailureLogPayload = (input: {
  tenantId: string;
  reminderId: string;
  reminderPublicId?: string;
  referenceId: string;
  stage: ReminderProcessingStage;
  jobId?: string;
  error: unknown;
  originalRecipient?: string | null;
  resolvedRecipient?: string | null;
  recipientSource?: string | null;
}) => {
  const summarized = summarizeReminderJobError(input.error);
  return withCategory("ERROR", {
    action: "send_reminder",
    tenantId: input.tenantId,
    jobId: input.jobId,
    reminderId: input.reminderId,
    reminderPublicId: input.reminderPublicId,
    referenceId: input.referenceId,
    stage: input.stage,
    failureCategory: failureCategoryByStage(input.stage),
    operatorMessage: summarized.operatorMessage,
    errorName: summarized.errorName,
    originalRecipient: input.originalRecipient ?? undefined,
    resolvedRecipient: input.resolvedRecipient ?? undefined,
    recipientSource: input.recipientSource ?? undefined
  });
};

export interface ReminderJobDeps {
  logger: LoggerLike;
  gatewayClient: WaGatewayDispatchClient;
  governancePort?: GovernancePort;
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
  jobId?: string;
  persistence?: ReminderPersistencePort;
}

export const processReminderJob = async (reminderId: string, deps: ReminderJobDeps): Promise<void> => {
  const persistence = deps.persistence ?? defaultPersistence;
  let stage: ReminderProcessingStage = "load_reminder";
  const reminder = await persistence.getReminderDispatchById(reminderId);
  if (!reminder) return;
  if (reminder.status !== ReminderStatus.SCHEDULED) {
    deps.logger.info(
      withCategory("QUEUE", {
        reminderId,
        reminderPublicId: reminder.publicId ?? reminder.id,
        status: reminder.status,
        jobId: deps.jobId
      }),
      "reminder already processed"
    );
    return;
  }

  stage = "resolve_recipient";
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
    reminderId: reminder.id,
    reminderPublicId: reminder.publicId ?? reminder.id,
    jobId: deps.jobId,
    tenantId,
    action: "send_reminder",
    referenceId,
    originalRecipient: recipient.originalRecipient,
    resolvedRecipient: recipient.resolvedRecipient,
    recipientSource: recipient.recipientSource
  };

  try {
    if (!recipient.resolvedRecipient) throw new Error("Reminder has no recipient");

    if (deps.governancePort) {
      stage = "governance_check";
      const governanceWaUserId =
        reminder.waUserId ?? (recipient.resolvedRecipient && !recipient.resolvedRecipient.endsWith("@g.us") ? recipient.resolvedRecipient : "unknown@s.whatsapp.net");
      const governanceDecision = await resolveGovernanceDecision(deps.governancePort, {
        tenant: { id: tenantId },
        user: { waUserId: governanceWaUserId },
        group: reminder.waGroupId
          ? {
              waGroupId: reminder.waGroupId
            }
          : undefined,
        context: {
          scope: reminder.waGroupId ? "group" : "private",
          isGroup: Boolean(reminder.waGroupId),
          routeKey: "worker.send_reminder"
        },
        consent: {
          bypass: true,
          required: false
        },
        request: {
          capability: reminder.waGroupId ? "conversation.group" : "conversation.direct",
          route: "worker.send_reminder"
        },
        runtimePolicySignals: {
          source: "worker",
          jobType: "send-reminder",
          jobId: deps.jobId,
          skipQuotaConsumption: true
        }
      });

      if (!governanceDecision.allow) {
        const denyReason = governanceDecision.reasonCodes.join(",") || "unknown";
        deps.logger.warn?.(
          withCategory("WARN", {
            action: "send_reminder",
            status: "worker_governance_execution_denied",
            tenantId,
            reminderId: reminder.id,
            reminderPublicId: reminder.publicId ?? reminder.id,
            referenceId,
            jobId: deps.jobId,
            waUserId: governanceWaUserId,
            waGroupId: reminder.waGroupId ?? undefined,
            reasonCodes: governanceDecision.reasonCodes,
            approvalState: governanceDecision.approval.state,
            planId: governanceDecision.licensing.planId,
            quota: governanceDecision.licensing.quota
          }),
          "worker reminder execution denied by current policy"
        );
        throw new Error(`worker_governance_execution_denied:${denyReason}`);
      }
    }

    stage = "dispatch_gateway";
    deps.logger.info(withCategory("WA-OUT", { ...logContext, waMessageId: null, stage }), "dispatching reminder");

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

    stage = "mark_sent_status";
    await persistence.updateReminderStatus(reminder.id, ReminderStatus.SENT);
    await persistence.markReminderMessage({ reminderId: reminder.id, messageId: sent.waMessageId });

    stage = "persist_outbound";
    const outboundWaUserId = reminder.waUserId ?? recipient.resolvedRecipient;
    await persistence.persistOutboundMessage({
      tenantId,
      userId: reminder.userId ?? undefined,
      groupId: reminder.groupId ?? undefined,
      waUserId: outboundWaUserId,
      waGroupId: reminder.waGroupId ?? undefined,
      text,
      waMessageId: sent.waMessageId,
      rawJson: sent.raw
    });

    stage = "metrics_audit";
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

    deps.logger.info(withCategory("WA-OUT", { ...logContext, stage: "completed", waMessageId: sent.waMessageId }), "reminder delivered");
  } catch (error) {
    await persistence.updateReminderStatus(reminder.id, ReminderStatus.FAILED).catch((statusError) => {
      deps.logger.warn?.(
        withCategory("WARN", {
          ...logContext,
          stage: "mark_failed_status",
          ...summarizeReminderJobError(statusError)
        }),
        "failed to persist reminder failed status"
      );
    });

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

    deps.logger.error(
      buildReminderFailureLogPayload({
        tenantId,
        reminderId: reminder.id,
        reminderPublicId: reminder.publicId ?? reminder.id,
        referenceId,
        stage,
        jobId: deps.jobId,
        error,
        originalRecipient: recipient.originalRecipient,
        resolvedRecipient: recipient.resolvedRecipient,
        recipientSource: recipient.recipientSource
      }),
      "failed to process reminder"
    );
    throw error;
  }
};
