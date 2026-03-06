import type { ConversationMessage, LlmPort, AiResponse, ToolIntent, ToolAction, AiAssistantInput } from "@zappy/core";
import { buildPrompt } from "./prompt-builder.js";
import { DEFAULT_PERSONA_ID, getPersona } from "./persona.js";
import { NoopConversationMemory } from "./memory.js";
import type { AiServiceConfig, ConversationMemoryPort, LoggerLike, PromptBuilderOutput } from "./types.js";

const DEFAULT_CONFIG: AiServiceConfig = {
  enabled: false,
  personaId: DEFAULT_PERSONA_ID,
  memoryWindow: 10
};

const TOOL_INTENT_HINTS: Array<{ action: ToolAction; patterns: RegExp[]; reason: string }> = [
  { action: "create_task", patterns: [/tarefa/i, /\btask\b/i, /to[- ]do/i], reason: "User asked to create or note a task" },
  { action: "list_tasks", patterns: [/listar.*tarefas/i, /tasks?\b.*list/i], reason: "User wants to see tasks" },
  { action: "create_reminder", patterns: [/lembrete/i, /remind/i, /\blembrar\b/i], reason: "User wants a reminder" },
  { action: "list_reminders", patterns: [/listar.*lembretes/i, /reminders?\b.*list/i], reason: "User wants to see reminders" },
  { action: "add_note", patterns: [/anot(a|e)/i, /\bnota\b/i, /\bnote\b/i], reason: "User wants to add a note" },
  { action: "list_notes", patterns: [/listar.*notas/i, /notes?\b.*list/i], reason: "User wants to see notes" },
  { action: "get_time", patterns: [/\bque horas\b/i, /\bhor[áa]rio\b/i, /\btime\b/i], reason: "User asked about time" },
  { action: "get_settings", patterns: [/config/i, /prefer[êe]ncias/i, /\bsettings?\b/i], reason: "User asked about settings" }
];

const detectToolIntent = (text: string, availableTools?: ToolAction[]): ToolIntent | null => {
  if (!text) return null;
  const tools = availableTools?.length ? availableTools : TOOL_INTENT_HINTS.map((t) => t.action);
  const entry = TOOL_INTENT_HINTS.find(
    (hint) => tools.includes(hint.action) && hint.patterns.some((p) => p.test(text))
  );
  if (!entry) return null;
  return { action: entry.action, reason: entry.reason, confidence: 0.35 };
};

export class AiService {
  private readonly llm?: LlmPort;
  private readonly memory: ConversationMemoryPort;
  private readonly config: AiServiceConfig;
  private readonly logger?: LoggerLike;
  private readonly unavailableText =
    "No momento o assistente inteligente está desabilitado. Use /help, /task ou /reminder para continuar.";

  constructor(input: { llm?: LlmPort; memory?: ConversationMemoryPort; config?: Partial<AiServiceConfig>; logger?: LoggerLike }) {
    this.llm = input.llm;
    this.memory = input.memory ?? new NoopConversationMemory();
    this.config = { ...DEFAULT_CONFIG, ...(input.config ?? {}) };
    this.logger = input.logger;
  }

  async generate(input: AiAssistantInput): Promise<AiResponse> {
    if (!this.config.enabled || input.llmEnabled === false) return { kind: "text", text: this.unavailableText };
    if (!this.llm) return { kind: "text", text: this.unavailableText };

    const persona = getPersona(input.personaId ?? this.config.personaId);
    const memoryLimit = this.config.memoryWindow;
    const recentMemory =
      memoryLimit > 0 && input.conversationId
        ? await this.memory.loadRecent({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            limit: memoryLimit
          })
        : [];

    const prompt = buildPrompt({
      persona,
      settings: input.settings,
      chatScope: input.chatScope,
      userRole: input.userRole,
      modulesEnabled: input.modulesEnabled,
      availableTools: input.availableTools,
      currentState: input.conversationState,
      handoffActive: input.handoffActive,
      memoryLimit,
      recentMemory,
      now: input.now,
      policyNotes: []
    });

    const toolIntent = detectToolIntent(input.userText, input.availableTools);
    const messages = this.toConversationMessages(prompt, input.userText);
    const text = await this.llm.chat({ system: prompt.systemPrompt, messages });
    if (text) await this.appendMemory(input, text);
    if (toolIntent) return { kind: "tool_suggestion", tool: toolIntent, text };
    return { kind: "text", text };
  }

  private toConversationMessages(prompt: PromptBuilderOutput, userText: string): ConversationMessage[] {
    const base = prompt.contextMessages ?? [];
    return [...base, { role: "user", content: userText }];
  }

  private async appendMemory(input: AiAssistantInput, assistantText: string) {
    if (!this.config.enabled) return;
    if (!this.memory || !input.conversationId) return;
    const keep = this.config.memoryWindow;
    const base = {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      waUserId: input.waUserId,
      keep
    };
    try {
      await this.memory.append({
        ...base,
        role: "user",
        content: input.userText
      });
      await this.memory.append({
        ...base,
        role: "assistant",
        content: assistantText
      });
    } catch (error) {
      this.logger?.warn?.({ err: error, conversationId: input.conversationId }, "failed to append ai memory");
    }
  }
}
