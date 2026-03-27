import { z } from "zod";

export const INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH = "/internal/media/resolve";

export const mediaResolverProviderSchema = z.enum(["yt", "ig", "fb", "direct"]);
export const mediaResolverStatusSchema = z.enum(["ready", "unsupported", "blocked", "invalid", "error"]);
export const mediaResolverResultKindSchema = z.enum([
  "preview_only",
  "image_post",
  "video_post",
  "reel_video",
  "blocked",
  "private",
  "login_required",
  "unsupported"
]);

export const mediaResolverAssetSchema = z.object({
  kind: z.enum(["audio", "video", "image", "document"]),
  mimeType: z.string().min(1),
  fileName: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  directUrl: z.string().min(1).optional(),
  bufferBase64: z.string().min(1).optional(),
  thumbnailUrl: z.string().min(1).optional()
});

export const mediaResolverResolveRequestSchema = z.object({
  provider: mediaResolverProviderSchema.optional(),
  url: z.string().url(),
  tenantId: z.string().min(1).optional(),
  waUserId: z.string().min(1).optional(),
  waGroupId: z.string().min(1).optional(),
  quality: z.enum(["low", "medium", "high", "best"]).optional(),
  maxBytes: z.number().int().positive().max(100 * 1024 * 1024).optional(),
  idempotencyKey: z.string().min(8).max(256).optional()
});

export const mediaResolverResolveResultSchema = z.object({
  provider: mediaResolverProviderSchema,
  detectedProvider: mediaResolverProviderSchema.optional(),
  status: mediaResolverStatusSchema,
  resultKind: mediaResolverResultKindSchema,
  reason: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  canonicalUrl: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  asset: mediaResolverAssetSchema.optional(),
  jobId: z.string().min(1).optional()
});

export const mediaResolverResolveSuccessSchema = z.object({
  ok: z.literal(true),
  result: mediaResolverResolveResultSchema
});

export const mediaResolverResolveErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string().min(1),
  code: z.string().min(1).optional()
});

export type MediaResolverProvider = z.infer<typeof mediaResolverProviderSchema>;
export type MediaResolverStatus = z.infer<typeof mediaResolverStatusSchema>;
export type MediaResolverResultKind = z.infer<typeof mediaResolverResultKindSchema>;
export type MediaResolverAsset = z.infer<typeof mediaResolverAssetSchema>;
export type MediaResolverResolveRequest = z.infer<typeof mediaResolverResolveRequestSchema>;
export type MediaResolverResolveResult = z.infer<typeof mediaResolverResolveResultSchema>;
export type MediaResolverResolveSuccess = z.infer<typeof mediaResolverResolveSuccessSchema>;
export type MediaResolverResolveError = z.infer<typeof mediaResolverResolveErrorSchema>;
