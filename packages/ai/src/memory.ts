import type { ConversationMemoryPort, MemoryEntry } from "./types.js";

export class NoopConversationMemory implements ConversationMemoryPort {
  async loadRecent(_input: { tenantId: string; conversationId: string; limit: number }): Promise<MemoryEntry[]> {
    return [];
  }

  async append(_entry: MemoryEntry): Promise<void> {
    // intentional noop
  }

  async trim(_input: { tenantId: string; conversationId: string; keep: number }): Promise<void> {
    // intentional noop
  }
}
