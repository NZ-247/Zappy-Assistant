import type { PipelineContext } from "../../../pipeline/context.js";
import type { ResponseAction } from "../../../pipeline/actions.js";
import { LlmError } from "../../../pipeline/types.js";
import type { AiAssistantPort, AiResponse, MetricKey, ToolAction } from "../../../pipeline/types.js";
import type { ConversationMemoryPort, LoggerPort, LlmPort, MetricsPort, PromptPort } from "../../../pipeline/ports.js";
import { AiRoutingService } from "./ai-routing-service.js";
import { mapPipelineToAiInput } from "../presentation/mappers/pipeline-to-ai-input.js";

const AVAILABLE_TOOLS: ToolAction[] = [
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "list_tasks",
  "create_reminder",
  "update_reminder",
  "delete_reminder",
  "list_reminders",
  "add_note",
  "list_notes",
  "get_time",
  "get_settings"
];

type AiFallbackDeps = {
  aiAssistant?: AiAssistantPort;
  aiAssistants?: Partial<Record<"ollama" | "openai", AiAssistantPort>>;
  llm: LlmPort;
  prompt: PromptPort;
  conversationMemory?: ConversationMemoryPort;
  llmEnabled?: boolean;
  llmModel?: string;
  llmMemoryMessages?: number;
  baseSystemPrompt?: string;
  logger?: LoggerPort;
  metrics?: MetricsPort;
};

export class AiFallbackService {
  private readonly routing: AiRoutingService;
  private readonly llmUnavailableText: string;
  private readonly deps: AiFallbackDeps;
  private readonly bumpMetric: (key: MetricKey, by?: number) => Promise<void>;

  constructor(input: {
    routing: AiRoutingService;
    llmUnavailableText: string;
    deps: AiFallbackDeps;
    bumpMetric: (key: MetricKey, by?: number) => Promise<void>;
  }) {
    this.routing = input.routing;
    this.llmUnavailableText = input.llmUnavailableText;
    this.deps = input.deps;
    this.bumpMetric = input.bumpMetric;
  }

  private relationshipNote(profile: PipelineContext["relationshipProfile"]): string | null {
    if (profile === "creator_root")
      return "Perfil de relacionamento: creator_root. Seja mais proativo e estratégico, sugira próximos passos de forma concisa e levemente descontraída.";
    if (profile === "mother_privileged")
      return "Perfil de relacionamento: mother_privileged. Use tom doce, respeitoso e gentil, como um filho bem comportado; apelidos suaves só quando apropriado; nunca use tom romântico.";
    return null;
  }

  private async storeAiMemory(ctx: PipelineContext, assistantText: string): Promise<void> {
    if (!this.deps.conversationMemory) return;
    if (!ctx.event.conversationId) return;
    const keepLatest = ctx.memoryLimit ?? this.deps.llmMemoryMessages ?? 10;
    const base = {
      tenantId: ctx.event.tenantId,
      conversationId: ctx.event.conversationId,
      waUserId: ctx.event.waUserId,
      keepLatest
    };
    try {
      await this.deps.conversationMemory.appendMemory({ ...base, role: "user", content: ctx.event.text });
      await this.deps.conversationMemory.appendMemory({ ...base, role: "assistant", content: assistantText });
    } catch (error) {
      this.deps.logger?.warn?.({ err: error, conversationId: ctx.event.conversationId }, "failed to store ai memory");
    }
  }

  private logAiResponse(ctx: PipelineContext, payload: Record<string, unknown>, msg: string): void {
    this.deps.logger?.info?.(
      {
        category: "AI",
        tenantId: ctx.event.tenantId,
        waUserId: ctx.event.waUserId,
        waGroupId: ctx.event.waGroupId,
        model: this.deps.llmModel ?? "unknown",
        aiEnabled: Boolean(this.deps.llmEnabled ?? true),
        ...payload
      },
      msg
    );
  }

  private logAiFailure(ctx: PipelineContext, error: unknown): void {
    const payload = {
      tenantId: ctx.event.tenantId,
      waUserId: ctx.event.waUserId,
      waGroupId: ctx.event.waGroupId,
      messageId: ctx.event.waMessageId,
      error,
      llmReason: error instanceof LlmError ? error.reason : "unknown"
    };
    if (this.deps.logger?.warn) {
      this.deps.logger.warn(payload, "ai fallback failed");
    } else {
      console.warn("ai fallback failed", payload);
    }
  }

  private buildAiAssistantInput(ctx: PipelineContext) {
    return mapPipelineToAiInput(ctx, AVAILABLE_TOOLS);
  }

  private guardAiResponse(ctx: PipelineContext, result: AiResponse): ResponseAction[] {
    if (result.kind === "text") {
      return this.routing.guardAiResponses(ctx, [{ kind: "reply_text", text: result.text ?? this.llmUnavailableText }]);
    }
    if (result.kind === "tool_suggestion") {
      return this.routing.guardAiResponses(ctx, [
        {
          kind: "ai_tool_suggestion",
          tool: result.tool,
          text: result.text
        }
      ]);
    }
    return this.routing.guardAiResponses(ctx, [{ kind: "reply_text", text: result.text ?? this.llmUnavailableText }]);
  }

  async generate(ctx: PipelineContext): Promise<ResponseAction[]> {
    if (ctx.groupPolicy?.commandsOnly) return [];
    if (ctx.policyMuted) return [];
    if (ctx.assistantMode === "off") return [];
    if (this.deps.llmEnabled === false) {
      return [{ kind: "reply_text", text: this.llmUnavailableText }];
    }

    const override = ctx.flags["runtime.ia.provider"];
    const selected = override === "ollama" || override === "openai" ? this.deps.aiAssistants?.[override] : undefined;
    if (this.deps.aiAssistants && (override === "ollama" || override === "openai") && !selected) {
      return [{ kind: "reply_text", text: this.llmUnavailableText }];
    }
    const aiAssistant = selected ?? this.deps.aiAssistant;
    if (aiAssistant) {
      try {
        await this.bumpMetric("ai_requests_total");
        const result = await aiAssistant.generate(this.buildAiAssistantInput(ctx));

        this.logAiResponse(ctx, { toolSuggestion: result.kind === "tool_suggestion" ? result.tool.action : undefined, fallback: result.kind === "fallback" }, "ai response");

        return this.guardAiResponse(ctx, result);
      } catch (error) {
        await this.bumpMetric("ai_failures_total");
        this.deps.logger?.warn?.(
          {
            category: "AI",
            traceId: ctx.event.executionId ?? ctx.event.waMessageId,
            status: "llm_call_failed",
            llmReason: error instanceof LlmError ? error.reason : "unknown",
            httpStatus: error instanceof LlmError ? error.status : undefined
          },
          "ai assistant failed"
        );
        return [{ kind: "reply_text", text: this.llmUnavailableText }];
      }
    }

    const promptOverride = await this.deps.prompt.resolvePrompt({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId
    });
    const systemBase =
      promptOverride ??
      this.deps.baseSystemPrompt ??
      "Você é Zappy, uma secretária eficiente e direta no WhatsApp. Ajude com tarefas, lembretes e respostas objetivas.";
    const relationshipNote = this.relationshipNote(ctx.relationshipProfile);
    const system = relationshipNote ? `${relationshipNote}\n${systemBase}` : systemBase;

    try {
      await this.bumpMetric("ai_requests_total");
      const llmText = await this.deps.llm.chat({
        system,
        messages: [...ctx.recentMessages, { role: "user", content: ctx.event.text }]
      });
      const sanitized = this.routing.sanitizeAiText(ctx, llmText);
      if (!sanitized) return [];
      await this.storeAiMemory(ctx, sanitized);
      this.logAiResponse(ctx, { fallback: false }, "llm response");
      return [{ kind: "reply_text", text: sanitized }];
    } catch (error) {
      await this.bumpMetric("ai_failures_total");
      this.logAiFailure(ctx, error);
      return [{ kind: "reply_text", text: this.llmUnavailableText }];
    }
  }
}
