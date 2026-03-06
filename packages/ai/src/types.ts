import type { ConversationMessage } from "@zappy/core";

export type PersonaId = "secretary_default" | string;
export type ChatScope = "group" | "direct";
export type UserRole = "ROOT" | "DONO" | "ADMIN" | "MEMBER";
export type FormalityLevel = "formal" | "neutral" | "casual";

export interface PersonaBehavior {
  respondNaturally: boolean;
  avoidOverexplaining: boolean;
  askForMissingDetails: boolean;
  preferStructuredAnswers: boolean;
  uncertaintyPolicy?: string;
}

export interface PersonaTone {
  client: string;
  owner: string;
}

export interface PersonaDefinition {
  id: PersonaId;
  name: string;
  description?: string;
  traits: string[];
  role: string;
  behavior: PersonaBehavior;
  tone: PersonaTone;
}

export interface EffectiveSettings {
  timezone?: string;
  language?: string;
  formality?: FormalityLevel;
}

export type AiMessageRole = "system" | "user" | "assistant" | "tool";

export interface AiMessage {
  role: AiMessageRole;
  content: string;
  name?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export interface MemoryEntry extends AiMessage {
  id?: string;
  tenantId: string;
  conversationId: string;
  waUserId?: string;
  waGroupId?: string;
}

export interface ConversationMemoryPort {
  loadRecent(input: { tenantId: string; conversationId: string; limit: number }): Promise<MemoryEntry[]>;
  append(entry: MemoryEntry): Promise<void>;
  trim?(input: { tenantId: string; conversationId: string; keep: number }): Promise<void>;
}

export interface PromptBuilderInput {
  persona: PersonaDefinition;
  settings?: EffectiveSettings;
  chatScope: ChatScope;
  userRole: UserRole;
  recentMemory?: MemoryEntry[];
  activeTools?: ToolAction[];
  now: Date;
  policyNotes?: string[];
}

export interface PromptBuilderOutput {
  systemPrompt: string;
  contextMessages: ConversationMessage[];
  policyNotes?: string[];
}

export type ToolAction =
  | "create_task"
  | "list_tasks"
  | "create_reminder"
  | "list_reminders"
  | "add_note"
  | "list_notes"
  | "get_time"
  | "get_settings";

export interface ToolIntent {
  action: ToolAction;
  payload?: Record<string, unknown>;
  confidence?: number;
  reason?: string;
}

export type AiResponse =
  | { kind: "text"; text: string; meta?: Record<string, unknown> }
  | { kind: "tool_suggestion"; tool: ToolIntent; text?: string; meta?: Record<string, unknown> };

export interface AiGenerateInput {
  tenantId: string;
  conversationId: string;
  waUserId: string;
  waGroupId?: string;
  userText: string;
  settings?: EffectiveSettings;
  chatScope: ChatScope;
  userRole: UserRole;
  activeTools?: ToolAction[];
  now: Date;
  llmEnabled?: boolean;
  personaId?: PersonaId;
}

export interface AiServiceConfig {
  enabled: boolean;
  personaId: PersonaId;
  memoryWindow: number;
}

export type PromptBuilderFn = (input: PromptBuilderInput) => Promise<PromptBuilderOutput> | PromptBuilderOutput;

export type LoggerLike = {
  warn(obj: unknown, msg?: string): void;
  error?(obj: unknown, msg?: string): void;
};
