import type { FeatureFlagInput, TriggerInput } from "@zappy/shared";

export interface FeatureFlagPort {
  list(): Promise<unknown[]>;
  create(input: FeatureFlagInput, actor: string): Promise<unknown>;
  update(id: string, input: FeatureFlagInput, actor: string): Promise<unknown>;
  remove(id: string, actor: string): Promise<void>;
}

export interface TriggerPort {
  list(): Promise<unknown[]>;
  create(input: TriggerInput, actor: string): Promise<unknown>;
  update(id: string, input: TriggerInput, actor: string): Promise<unknown>;
  remove(id: string, actor: string): Promise<void>;
}

export interface AuditLogPort {
  list(limit: number): Promise<unknown[]>;
}

export interface QueuePort {
  enqueue(name: string, payload: unknown): Promise<void>;
}
