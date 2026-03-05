declare module "openai" {
  interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
  }

  interface ChatCompletionResponse {
    choices: Array<{ message?: { content?: string | null } }>;
  }

  export default class OpenAI {
    constructor(options: { apiKey?: string });
    chat: {
      completions: {
        create(input: { model: string; messages: ChatMessage[] }): Promise<ChatCompletionResponse>;
      };
    };
  }
}
