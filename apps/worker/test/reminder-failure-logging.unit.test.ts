import { strict as assert } from "node:assert";
import test from "node:test";
import { buildReminderFailureLogPayload } from "../src/reminders/application/use-cases/process-reminder-job.js";

test("reminder failure payload includes correlation fields and concise operator error", () => {
  const payload = buildReminderFailureLogPayload({
    tenantId: "tenant_test",
    reminderId: "uuid-reminder-1",
    reminderPublicId: "RMD001",
    referenceId: "RMD001",
    stage: "dispatch_gateway",
    jobId: "job-77",
    error: new Error("gateway returned 500 on /internal/send with timeout"),
    originalRecipient: "group:123",
    resolvedRecipient: "5511999999999@s.whatsapp.net",
    recipientSource: "group_fallback_user"
  }) as Record<string, unknown>;

  assert.equal(payload.category, "ERROR");
  assert.equal(payload.action, "send_reminder");
  assert.equal(payload.jobId, "job-77");
  assert.equal(payload.reminderId, "uuid-reminder-1");
  assert.equal(payload.reminderPublicId, "RMD001");
  assert.equal(payload.referenceId, "RMD001");
  assert.equal(payload.stage, "dispatch_gateway");
  assert.equal(payload.failureCategory, "gateway_dispatch_request_failed");
  assert.match(String(payload.operatorMessage ?? ""), /gateway returned 500/i);
  assert.equal(payload.resolvedRecipient, "5511999999999@s.whatsapp.net");
});
