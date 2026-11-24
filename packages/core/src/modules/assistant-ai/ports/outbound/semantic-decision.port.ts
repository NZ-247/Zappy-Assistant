export type SemanticDecisionFailure = "timeout" | "http_error" | "network_error" | "invalid_response";

export interface SemanticDecisionPort {
  readonly model: string;
  decide(text: string): Promise<
    | { ok: true; output: unknown }
    | { ok: false; reason: SemanticDecisionFailure; httpStatus?: number }
  >;
}
