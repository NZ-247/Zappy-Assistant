import type { LoggerPort } from "../../../../pipeline/ports.js";
import { parseSemanticDecision } from "../../domain/semantic-decision.js";
import type { SemanticDecisionPort } from "../../ports/outbound/semantic-decision.port.js";

export class SemanticDecisionObserver {
  private busy = false;

  constructor(private readonly port: SemanticDecisionPort, private readonly logger?: LoggerPort) {}

  observe(correlationId: string, text: string): void {
    const fields = { category: "SEMANTIC_SHADOW", correlationId, model: this.port.model };
    if (this.busy) {
      this.logger?.info?.({ ...fields, status: "skipped", reason: "busy", latencyMs: 0 }, "semantic shadow decision");
      return;
    }

    this.busy = true;
    const started = performance.now();
    void this.evaluate(text, fields, started);
  }

  private async evaluate(text: string, fields: Record<string, string>, started: number): Promise<void> {
    try {
      // Defer the adapter call so it cannot hold up the inbound pipeline.
      const result = await Promise.resolve().then(() => this.port.decide(text));
      const latencyMs = Math.round(performance.now() - started);
      if (!result.ok) {
        this.logger?.warn({ ...fields, status: "error", reason: result.reason, httpStatus: result.httpStatus, latencyMs }, "semantic shadow decision");
        return;
      }
      const decision = parseSemanticDecision(result.output);
      if (!decision) {
        this.logger?.warn({ ...fields, status: "error", reason: "invalid_response", latencyMs }, "semantic shadow decision");
        return;
      }
      this.logger?.info?.({ ...fields, status: "ok", decision, latencyMs }, "semantic shadow decision");
    } catch {
      this.logger?.warn({
        ...fields, status: "error", reason: "adapter_error", latencyMs: Math.round(performance.now() - started)
      }, "semantic shadow decision");
    } finally {
      this.busy = false;
    }
  }
}
