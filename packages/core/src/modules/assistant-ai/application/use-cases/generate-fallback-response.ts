import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import { AiFallbackService } from "../../services/ai-fallback-service.js";

export type GenerateFallbackDeps = {
  fallbackService: AiFallbackService;
};

export const generateFallbackResponse = async (
  ctx: PipelineContext,
  deps: GenerateFallbackDeps
): Promise<ResponseAction[]> => deps.fallbackService.generate(ctx);
