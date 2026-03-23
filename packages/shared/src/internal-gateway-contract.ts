import { z } from "zod";

export const INTERNAL_GATEWAY_SEND_TEXT_PATH = "/internal/messages/text";

export const internalGatewayActionSchema = z.enum(["send_reminder", "fire_timer"]);

export const internalGatewaySendTextRequestSchema = z.object({
  tenantId: z.string().min(1),
  to: z.string().min(1),
  text: z.string().min(1),
  action: internalGatewayActionSchema,
  referenceId: z.string().min(1),
  waUserId: z.string().min(1).optional(),
  waGroupId: z.string().min(1).optional()
});

export const internalGatewaySendTextSuccessSchema = z.object({
  ok: z.literal(true),
  waMessageId: z.string().min(1),
  raw: z.unknown().optional()
});

export const internalGatewaySendTextErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string().min(1),
  code: z.string().min(1).optional()
});

export type InternalGatewayAction = z.infer<typeof internalGatewayActionSchema>;
export type InternalGatewaySendTextRequest = z.infer<typeof internalGatewaySendTextRequestSchema>;
export type InternalGatewaySendTextSuccess = z.infer<typeof internalGatewaySendTextSuccessSchema>;
export type InternalGatewaySendTextError = z.infer<typeof internalGatewaySendTextErrorSchema>;
