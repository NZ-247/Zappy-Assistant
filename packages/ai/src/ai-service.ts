import type { ConversationMessage, LlmPort, AiResponse, ToolIntent, ToolAction, AiAssistantInput } from "@zappy/core";
import { buildPrompt } from "./prompt-builder.js";
import { DEFAULT_PERSONA_ID, getPersonaWithProfile } from "./persona.js";
import { NoopConversationMemory } from "./memory.js";
import type { AiServiceConfig, ConversationMemoryPort, LoggerLike, PromptBuilderOutput } from "./types.js";

const DEFAULT_CONFIG: AiServiceConfig = {
  enabled: false,
  personaId: DEFAULT_PERSONA_ID,
  memoryWindow: 10,
  commandPrefix: "/"
};

const TOOL_INTENT_HINTS: Array<{ action: ToolAction; patterns: RegExp[]; reason: string }> = [
  { action: "create_task", patterns: [/tarefa/i, /\btask\b/i, /to[- ]do/i], reason: "User asked to create or note a task" },
  { action: "update_task", patterns: [/edita.*tarefa/i, /atualiza.*tarefa/i], reason: "User asked to update a task" },
  { action: "complete_task", patterns: [/conclu[ií]d.*tarefa/i, /marca.*tarefa.*feito/i], reason: "User wants to complete a task" },
  { action: "delete_task", patterns: [/remove.*tarefa/i, /apaga.*tarefa/i], reason: "User wants to delete a task" },
  { action: "list_tasks", patterns: [/listar.*tarefas/i, /tasks?\b.*list/i], reason: "User wants to see tasks" },
  { action: "create_reminder", patterns: [/lembrete/i, /remind/i, /\blembrar\b/i], reason: "User wants a reminder" },
  { action: "update_reminder", patterns: [/edita.*lembrete/i, /atualiza.*lembrete/i], reason: "User wants to update a reminder" },
  { action: "delete_reminder", patterns: [/cancela.*lembrete/i, /apaga.*lembrete/i], reason: "User wants to delete a reminder" },
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
  private readonly unavailableText: string;

  constructor(input: { llm?: LlmPort; memory?: ConversationMemoryPort; config?: Partial<AiServiceConfig>; logger?: LoggerLike }) {
    this.llm = input.llm;
    this.memory = input.memory ?? new NoopConversationMemory();
    this.config = { ...DEFAULT_CONFIG, ...(input.config ?? {}) };
    this.logger = input.logger;
    this.unavailableText = this.buildUnavailableText();
  }

  async generate(input: AiAssistantInput): Promise<AiResponse> {
    if (!this.config.enabled || input.llmEnabled === false) return { kind: "text", text: this.unavailableText };
    if (!this.llm) return { kind: "text", text: this.unavailableText };

    const { persona, modifier } = getPersonaWithProfile({
      personaId: input.personaId ?? this.config.personaId,
      relationshipProfile: input.relationshipProfile
    });
    const memoryLimit = modifier?.memoryWindowOverride ?? this.config.memoryWindow;
    const policyNotes = [...(modifier?.policyNotes ?? [])];
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
      relationshipProfile: input.relationshipProfile,
      profileModifier: modifier,
      modulesEnabled: input.modulesEnabled,
      availableTools: input.availableTools,
      currentState: input.conversationState,
      handoffActive: input.handoffActive,
      memoryLimit,
      recentMemory,
      now: input.now,
      policyNotes
    });

    const toolIntent = detectToolIntent(input.userText, input.availableTools);
    const messages = this.toConversationMessages(prompt, input.userText);
    const text = await this.llm.chat({ system: prompt.systemPrompt, messages });
    if (text) await this.appendMemory(input, text, memoryLimit);
    if (toolIntent) return { kind: "tool_suggestion", tool: toolIntent, text };
    return { kind: "text", text };
  }

  private toConversationMessages(prompt: PromptBuilderOutput, userText: string): ConversationMessage[] {
    const base = prompt.contextMessages ?? [];
    return [...base, { role: "user", content: userText }];
  }

  private async appendMemory(input: AiAssistantInput, assistantText: string, keepOverride?: number) {
    if (!this.config.enabled) return;
    if (!this.memory || !input.conversationId) return;
    const keep = keepOverride ?? this.config.memoryWindow;
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

  private buildUnavailableText(): string {
    const prefix = this.config.commandPrefix ?? "/";
    return `No momento o assistente inteligente está desabilitado. Use ${prefix}help, ${prefix}task ou ${prefix}reminder para continuar.`;
  }
}
