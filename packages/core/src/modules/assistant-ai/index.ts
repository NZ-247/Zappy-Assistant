import type { PipelineContext } from "../../pipeline/context.js";
import type { ResponseAction } from "../../pipeline/actions.js";
import type { CorePorts, MetricsPort } from "../../pipeline/ports.js";
import type { MetricKey } from "../../pipeline/types.js";
import { handleAddressedMessage } from "./application/use-cases/handle-addressed-message.js";
import { runSlotFilling } from "./application/use-cases/run-slot-filling.js";
import { generateFallbackResponse } from "./application/use-cases/generate-fallback-response.js";
import { AiRoutingService } from "./services/ai-routing-service.js";
import { AiFallbackService } from "./services/ai-fallback-service.js";
import type { ToolExecutionDeps } from "./application/use-cases/execute-tool-intent.js";
import { clearConversationState } from "./services/conversation-state-helpers.js";

export type AssistantAiModuleDeps = {
  ports: CorePorts;
  commandPrefix: string;
  pendingStateTtlMs: number;
  llmUnavailableText: string;
  hasRootPrivilege: (ctx: PipelineContext) => boolean;
  bumpMetric: (key: MetricKey, by?: number) => Promise<void>;
  stylizeReply: (ctx: PipelineContext, text: string, options?: { suggestNext?: string }) => string;
};

export class AssistantAiModule {
  private readonly routing: AiRoutingService;
  private readonly fallbackService: AiFallbackService;
  private readonly deps: AssistantAiModuleDeps;

  constructor(deps: AssistantAiModuleDeps) {
    this.deps = deps;
    this.routing = new AiRoutingService({ hasRootPrivilege: deps.hasRootPrivilege });
    this.fallbackService = new AiFallbackService({
      routing: this.routing,
      llmUnavailableText: deps.llmUnavailableText,
      deps: {
        aiAssistant: deps.ports.aiAssistant,
        llm: deps.ports.llm,
        prompt: deps.ports.prompt,
        conversationMemory: deps.ports.conversationMemory,
        llmEnabled: deps.ports.llmEnabled,
        llmModel: deps.ports.llmModel,
        llmMemoryMessages: deps.ports.llmMemoryMessages,
        baseSystemPrompt: deps.ports.baseSystemPrompt,
        logger: deps.ports.logger,
        metrics: deps.ports.metrics
      },
      bumpMetric: deps.bumpMetric
    });
  }

  async handleAddressedMessage(ctx: PipelineContext): Promise<ResponseAction[]> {
    const toolExecution: ToolExecutionDeps = {
      tasksRepository: this.deps.ports.tasksRepository,
      remindersRepository: this.deps.ports.remindersRepository,
      notesRepository: this.deps.ports.notesRepository,
      stylizeReply: (text) => this.deps.stylizeReply(ctx, text),
      timezone: ctx.timezone
    };

    return handleAddressedMessage(ctx, {
      conversationState: this.deps.ports.conversationState,
      pendingStateTtlMs: this.deps.pendingStateTtlMs,
      stylizeReply: (text) => this.deps.stylizeReply(ctx, text),
      toolExecution
    });
  }

  async handlePendingToolFollowUp(ctx: PipelineContext): Promise<ResponseAction[]> {
    const toolExecution: ToolExecutionDeps = {
      tasksRepository: this.deps.ports.tasksRepository,
      remindersRepository: this.deps.ports.remindersRepository,
      notesRepository: this.deps.ports.notesRepository,
      stylizeReply: (text) => this.deps.stylizeReply(ctx, text),
      timezone: ctx.timezone
    };

    return runSlotFilling(ctx, {
      conversationState: this.deps.ports.conversationState,
      pendingStateTtlMs: this.deps.pendingStateTtlMs,
      stylizeReply: (text) => this.deps.stylizeReply(ctx, text),
      toolExecution,
      commandPrefix: this.deps.commandPrefix
    });
  }

  async runFallback(ctx: PipelineContext): Promise<ResponseAction[]> {
    return generateFallbackResponse(ctx, { fallbackService: this.fallbackService });
  }

  async clearState(ctx: PipelineContext): Promise<void> {
    await clearConversationState(ctx, this.deps.ports.conversationState);
  }
}

export * from "./application/use-cases/handle-addressed-message.js";
export * from "./application/use-cases/run-slot-filling.js";
export * from "./application/use-cases/generate-fallback-response.js";
export * from "./application/use-cases/infer-tool-intent.js";
export * from "./application/use-cases/execute-tool-intent.js";
export * from "./services/ai-routing-service.js";
export * from "./services/ai-fallback-service.js";
export * from "./presentation/mappers/pipeline-to-ai-input.js";
