import type {
  ConversationMessage,
  AiAssistantInput,
  AiResponse,
  ToolAction,
  ToolIntent,
  RelationshipProfile
} from "@zappy/core";

export type PersonaId = "secretary_default" | string;
export type ChatScope = "group" | "direct";
export type UserRole = "ROOT" | "DONO" | "GROUP_ADMIN" | "ADMIN" | "MEMBER";
export type FormalityLevel = "formal" | "neutral" | "casual";

export interface PersonaBehavior {
  respondNaturally: boolean;
  avoidOverexplaining: boolean;
  askForMissingDetails: boolean;
  preferStructuredAnswers: boolean;
  uncertaintyPolicy?: string;
  initiativeLevel?: "low" | "medium" | "high";
  creativityLevel?: "low" | "medium" | "high";
  suggestionTone?: string;
}

export interface PersonaTone {
  client: string;
  owner: string;
  profileNote?: string;
}

export interface PersonaDefinition {
  id: PersonaId;
  name: string;
  description?: string;
  traits: string[];
  role: string;
  behavior: PersonaBehavior;
  tone: PersonaTone;
  profileModifiers?: Record<RelationshipProfile, PersonaProfileModifier>;
  examples?: {
    directAssistant?: string;
    businessClient?: string;
    operationalSummary?: string;
  };
}

export interface PersonaProfileModifier {
  id: RelationshipProfile;
  label: string;
  summary: string;
  traitsAdd?: string[];
  toneOverrides?: Partial<PersonaTone>;
  behaviorOverrides?: Partial<PersonaBehavior>;
  policyNotes?: string[];
  promptAdditions?: string[];
  affectionateForms?: string[];
  memoryWindowOverride?: number;
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
  userDisplayName?: string;
  relationshipProfile?: RelationshipProfile;
  profileModifier?: PersonaProfileModifier;
  modulesEnabled?: string[];
  availableTools?: ToolAction[];
  currentState?: string;
  handoffActive?: boolean;
  memoryLimit?: number;
  recentMemory?: MemoryEntry[];
  now: Date;
  policyNotes?: string[];
}

export interface PromptBuilderOutput {
  systemPrompt: string;
  contextMessages: ConversationMessage[];
  policyNotes?: string[];
  toolHints?: string[];
  profileSummary?: string;
}

export type AiGenerateInput = AiAssistantInput;

export interface AiServiceConfig {
  enabled: boolean;
  personaId: PersonaId;
  memoryWindow: number;
  commandPrefix?: string;
}

export type PromptBuilderFn = (input: PromptBuilderInput) => Promise<PromptBuilderOutput> | PromptBuilderOutput;

export type LoggerLike = {
  info?(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error?(obj: unknown, msg?: string): void;
};
