import { isTriggerMatch, renderTemplate } from "../common/trigger-utils.js";
import { formatDateTimeInZone } from "../time.js";
import type { ResponseAction } from "../pipeline/actions.js";
import type { PipelineContext } from "../pipeline/context.js";
import type { AuditEvent, MetricKey, TriggerRule } from "../pipeline/types.js";

export interface PolicyTriggerDeps {
  greetingCooldownSeconds: number;
  botName?: string;
  stylizeReply: (ctx: PipelineContext, text: string, options?: { suggestNext?: string }) => string;
  shouldSkipGenericGreeting: (ctx: PipelineContext) => boolean;
  isGreetingMessage: (text: string) => boolean;
  isGreetingPattern: (pattern: string) => boolean;
  recordAudit: (event: AuditEvent) => Promise<void>;
  bumpMetric: (key: MetricKey, by?: number) => Promise<void>;
  loadTriggers: (input: { tenantId: string; waGroupId?: string; waUserId: string }) => Promise<TriggerRule[]>;
  canFireCooldown: (key: string, ttlSeconds: number) => Promise<boolean>;
}

export const runGreetingStage = async (ctx: PipelineContext, deps: PolicyTriggerDeps): Promise<ResponseAction[]> => {
  if (ctx.groupPolicy?.commandsOnly) return [];
  if (ctx.policyMuted) return [];
  if (ctx.consentRequired) return [];
  if (deps.shouldSkipGenericGreeting(ctx)) return [];
  if (ctx.classification.kind !== "trigger_candidate" && ctx.classification.kind !== "ai_candidate") return [];
  if (!deps.isGreetingMessage(ctx.event.normalizedText)) return [];

  const scopePart = ctx.event.waGroupId ?? ctx.event.waUserId;
  const key = `greeting:${ctx.event.tenantId}:${scopePart}`;
  const canFire = await deps.canFireCooldown(key, deps.greetingCooldownSeconds);
  if (!canFire) return [];

  const text = deps.stylizeReply(
    ctx,
    "Olá! Sou Zappy, assistente digital da Services.NET. Posso ajudar com suporte, orçamento, agendamento ou dúvidas. Como posso ajudar?"
  );
  return [{ kind: "reply_text", text }];
};

export const runBusinessTriggers = async (ctx: PipelineContext, deps: PolicyTriggerDeps): Promise<ResponseAction[]> => {
  if (ctx.groupPolicy?.commandsOnly) return [];
  if (ctx.policyMuted) return [];
  if (ctx.classification.kind === "command") return [];
  if (ctx.classification.kind === "tool_follow_up") return [];
  if (ctx.classification.kind === "ignored_event" || ctx.classification.kind === "system_event") return [];

  const suppressGreeting = deps.shouldSkipGenericGreeting(ctx);
  const triggers = await deps.loadTriggers({
    tenantId: ctx.event.tenantId,
    waGroupId: ctx.event.waGroupId,
    waUserId: ctx.event.waUserId
  });

  const bot = deps.botName ?? "Zappy";
  const nowFormatted = formatDateTimeInZone(ctx.now, ctx.timezone);

  for (const trigger of triggers) {
    if (!trigger.enabled) continue;
    if (!isTriggerMatch(ctx.event.normalizedText, trigger)) continue;
    if (trigger.name.toLowerCase().includes("fun") && ctx.funMode !== "on") continue;
    const isGreetingTrigger = deps.isGreetingPattern(trigger.pattern);
    if (isGreetingTrigger) {
      if (suppressGreeting) continue;
      if (!deps.isGreetingMessage(ctx.event.normalizedText)) continue;
    }

    const scopePart = ctx.event.waGroupId ?? ctx.event.waUserId;
    const key = `cooldown:${trigger.id}:${scopePart}`;
    const canFire = await deps.canFireCooldown(key, Math.max(1, trigger.cooldownSeconds));
    if (!canFire) continue;

    await deps.recordAudit({
      kind: "trigger",
      tenantId: ctx.event.tenantId,
      waUserId: ctx.event.waUserId,
      waGroupId: ctx.event.waGroupId,
      conversationId: ctx.event.conversationId,
      triggerId: trigger.id,
      triggerName: trigger.name
    });
    await deps.bumpMetric("trigger_matches_total");

    return [
      {
        kind: "reply_text",
        text: renderTemplate(trigger.responseTemplate, {
          user: ctx.event.waUserId,
          group: ctx.event.waGroupId ?? "direct",
          bot,
          date: nowFormatted
        })
      }
    ];
  }

  return [];
};
