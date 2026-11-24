export const ZABBIX_REPORT_MAX_HOURS = 168;

export type SemanticDecision =
  | { kind: "propose"; tool: "zabbix_report"; hours: number }
  | { kind: "clarify" }
  | { kind: "unsupported" };

export function parseSemanticDecision(value: unknown): SemanticDecision | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("kind" in value)) return;
  const keyCount = Object.keys(value).length;
  if (keyCount === 1 && (value.kind === "clarify" || value.kind === "unsupported")) {
    return { kind: value.kind };
  }
  if (
    keyCount === 3 && value.kind === "propose" && "tool" in value && value.tool === "zabbix_report" &&
    "hours" in value && typeof value.hours === "number" && Number.isInteger(value.hours) &&
    value.hours >= 1 && value.hours <= ZABBIX_REPORT_MAX_HOURS
  ) {
    return { kind: "propose", tool: value.tool, hours: value.hours };
  }
}
