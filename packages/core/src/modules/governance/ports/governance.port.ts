import type {
  DecisionInput,
  GovernancePolicySnapshot,
  GovernanceQuotaConsumeInput,
  GovernanceQuotaConsumeResult
} from "../domain/governance-decision.js";

export interface GovernancePort {
  getSnapshot(input: DecisionInput): Promise<GovernancePolicySnapshot>;
  consumeQuota?(input: GovernanceQuotaConsumeInput): Promise<GovernanceQuotaConsumeResult>;
}
