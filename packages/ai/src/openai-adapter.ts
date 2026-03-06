import OpenAI from "openai";
import { LlmError, type ConversationMessage, type LlmErrorReason, type LlmPort } from "@zappy/core";

const classifyOpenAiError = (error: unknown): { reason: LlmErrorReason; status?: number; code?: string } => {
  const asAny = error as { status?: unknown; code?: unknown; type?: unknown };
  const status = typeof asAny?.status === "number" ? asAny.status : undefined;
  const code = typeof asAny?.code === "string" ? asAny.code : undefined;
  const type = typeof asAny?.type === "string" ? asAny.type : undefined;

  if (code === "insufficient_quota" || type === "insufficient_quota") return { reason: "insufficient_quota", status, code };
  if (status === 429 || code === "rate_limit_exceeded" || type === "rate_limit_exceeded") return { reason: "rate_limit", status, code };
  if (status === 408 || code === "ETIMEDOUT" || code === "ETIMEOUT") return { reason: "timeout", status, code };
  if (code && ["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH"].includes(code)) return { reason: "network", status, code };
  if (status && status >= 500) return { reason: "network", status, code };

  return { reason: "unknown", status, code };
};

export const createOpenAiChatAdapter = (input: { apiKey?: string; model: string; temperature?: number }): LlmPort => {
  const client = input.apiKey ? new OpenAI({ apiKey: input.apiKey }) : null;
  return {
    chat: async ({ system, messages }: { system: string; messages: ConversationMessage[] }) => {
      if (!client) throw new LlmError("unknown", "LLM not configured");
      try {
        const completion = await client.chat.completions.create({
          model: input.model,
          temperature: input.temperature ?? 0.2,
          messages: [{ role: "system", content: system }, ...messages]
        });
        return completion.choices[0]?.message?.content ?? "";
      } catch (error) {
        const { reason, status, code } = classifyOpenAiError(error);
        throw new LlmError(reason, "LLM request failed", { status, code, cause: error });
      }
    }
  };
};
