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

export const internalGatewaySendStatusSchema = z.enum(["sent", "failed"]);

export const internalGatewaySendTextSuccessSchema = z
  .object({
    ok: z.literal(true),
    dispatchAccepted: z.literal(true),
    sendStatus: internalGatewaySendStatusSchema,
    waMessageId: z.string().min(1).optional(),
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
    raw: z.unknown().optional()
  })
  .superRefine((value, ctx) => {
    if (value.sendStatus === "sent" && !value.waMessageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["waMessageId"],
        message: "waMessageId is required when sendStatus=sent"
      });
    }
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
