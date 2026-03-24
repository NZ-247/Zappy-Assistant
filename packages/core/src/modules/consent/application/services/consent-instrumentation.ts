import type { AuditPort, LoggerPort, MetricsPort } from "../../ports.js";
import type { AuditEvent, MetricKey } from "../../../../pipeline/types.js";

export const safeRecordAudit = async (
  audit: AuditPort | undefined,
  logger: LoggerPort | undefined,
  event: AuditEvent
): Promise<void> => {
  if (!audit) return;
  try {
    await audit.record(event);
  } catch (error) {
    logger?.warn?.({ err: error, eventKind: event.kind }, "audit record failed");
  }
};

export const safeBumpMetric = async (
  metrics: MetricsPort | undefined,
  logger: LoggerPort | undefined,
  key: MetricKey,
  by = 1
): Promise<void> => {
  if (!metrics) return;
  try {
    await metrics.increment(key, by);
  } catch (error) {
    logger?.debug?.({ err: error, metric: key }, "metric increment failed");
  }
};
