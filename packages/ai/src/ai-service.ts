import type { ConversationMessage, LlmPort } from "@zappy/core";
import { buildSystemPrompt, type PromptOptions } from "./prompt-builder.js";

export class AiService {
  private readonly basePrompt: string;
  private readonly llm: LlmPort;
  private readonly unavailableText =
    "No momento estou sem acesso ao assistente inteligente. Você ainda pode usar /help, /task e /reminder.";

  constructor(llm: LlmPort, options?: PromptOptions) {
    this.llm = llm;
    this.basePrompt = buildSystemPrompt(options);
  }

  get prompt(): string {
    return this.basePrompt;
  }

  async reply(input: {
    messages: ConversationMessage[];
    userText: string;
    systemPrompt?: string;
    llmEnabled?: boolean;
  }): Promise<string> {
    if (input.llmEnabled === false) return this.unavailableText;
    const system = input.systemPrompt ?? this.basePrompt;
    return this.llm.chat({ system, messages: [...input.messages, { role: "user", content: input.userText }] });
  }
}
