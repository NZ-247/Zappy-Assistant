import { LlmError, type LlmPort } from "@zappy/core";

export function createOllamaChatAdapter(config: {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  format?: Record<string, unknown>;
}, request: typeof fetch = fetch): LlmPort {
  const url = new URL("/api/chat", config.baseUrl);

  return {
    async chat({ system, messages, signal: parentSignal }) {
      const timeout = AbortSignal.timeout(config.timeoutMs);
      const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
      try {
        const response = await request(url, {
          method: "POST",
          redirect: "manual",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            format: config.format,
            think: false,
            options: { num_ctx: 2048, temperature: 0, num_predict: 256 },
            messages: [{ role: "system", content: system }, ...messages]
          })
        });

        if (!response.ok) {
          await response.body?.cancel();
          const status = response.status;
          const reason = status === 429 ? "rate_limit" : status === 408 || status === 504 ? "timeout" : status >= 500 ? "network" : "unknown";
          throw new LlmError(reason, "Ollama chat request failed", { status });
        }

        const envelope = await response.json();
        const content: unknown = envelope?.message?.content;
        if (envelope?.done !== true || envelope?.done_reason === "length" || typeof content !== "string" || !content.trim()) {
          throw new LlmError("unknown", "Ollama returned no complete chat response");
        }

        return content.trim();
      } catch (error) {
        if (signal.aborted) throw new LlmError("timeout", "Ollama chat timed out");
        if (error instanceof LlmError) throw error;
        if (error instanceof SyntaxError) throw new LlmError("unknown", "Ollama returned invalid JSON");
        throw new LlmError("network", "Ollama chat request failed");
      }
    }
  };
}
