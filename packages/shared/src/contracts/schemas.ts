import { z } from "zod";

export const idSchema = z.object({ id: z.string().uuid() });

export const featureFlagSchema = z.object({
  key: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  value: z.string().default("on"),
  scope: z.enum(["GLOBAL", "TENANT", "GROUP", "USER"]),
  tenantId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  userId: z.string().uuid().optional()
});

export const triggerSchema = z.object({
  name: z.string().min(1),
  pattern: z.string().min(1),
  responseTemplate: z.string().min(1),
  matchType: z.enum(["CONTAINS", "REGEX", "STARTS_WITH"]),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  cooldownSeconds: z.number().int().min(0).default(0),
  scope: z.enum(["GLOBAL", "TENANT", "GROUP", "USER"]).default("GLOBAL"),
  tenantId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  userId: z.string().uuid().optional()
});

export type FeatureFlagInput = z.infer<typeof featureFlagSchema>;
export type TriggerInput = z.infer<typeof triggerSchema>;
