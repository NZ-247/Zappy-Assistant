import type { ConversationMessage, LlmPort } from "@zappy/core";
import { buildPrompt } from "./prompt-builder.js";
import { DEFAULT_PERSONA_ID, getPersona } from "./persona.js";
import { NoopConversationMemory } from "./memory.js";
import type {
  AiGenerateInput,
  AiResponse,
  AiServiceConfig,
  ConversationMemoryPort,
  LoggerLike,
  PromptBuilderOutput
} from "./types.js";

const DEFAULT_CONFIG: AiServiceConfig = {
  enabled: false,
  personaId: DEFAULT_PERSONA_ID,
  memoryWindow: 0
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

  async generate(input: AiGenerateInput): Promise<AiResponse> {
    if (!this.config.enabled || input.llmEnabled === false) return { kind: "text", text: this.unavailableText };
    if (!this.llm) return { kind: "text", text: this.unavailableText };

    const persona = getPersona(input.personaId ?? this.config.personaId);
    const memoryLimit = this.config.memoryWindow;
    const recentMemory =
      memoryLimit > 0
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
      recentMemory,
      activeTools: input.activeTools,
      now: input.now,
      policyNotes: []
    });

    const messages = this.toConversationMessages(prompt, input.userText);
    const text = await this.llm.chat({ system: prompt.systemPrompt, messages });
    return { kind: "text", text };
  }

  private toConversationMessages(prompt: PromptBuilderOutput, userText: string): ConversationMessage[] {
    const base = prompt.contextMessages ?? [];
    return [...base, { role: "user", content: userText }];
  }
}
