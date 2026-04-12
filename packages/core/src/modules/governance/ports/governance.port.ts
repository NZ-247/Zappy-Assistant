import type { DecisionInput, GovernancePolicySnapshot } from "../domain/governance-decision.js";

export interface GovernancePort {
  getSnapshot(input: DecisionInput): Promise<GovernancePolicySnapshot>;
}
