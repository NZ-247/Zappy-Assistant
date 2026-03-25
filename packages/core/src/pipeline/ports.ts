import type {
  AiAssistantPort,
  AuditEvent,
  CanonicalIdentity,
  ConversationMessage,
  ConversationState,
  ConversationStateRecord,
  ConsentStatus,
  RelationshipProfile,
  GroupAccessState,
  GroupChatMode,
  MetricKey,
  NoteRecord,
  ReminderCreateInput,
  ReminderRecord,
  Scope,
  StatusSnapshot,
  TaskListItem,
  TimerCreateInput,
  TimerRecord,
  TriggerRule,
  UserConsentRecord
} from "./types.js";

export interface GroupAccessPort {
  getGroupAccess(input: { tenantId: string; waGroupId: string; groupName?: string | null; botIsAdmin?: boolean | null }): Promise<GroupAccessState>;
  setAllowed(input: { tenantId: string; waGroupId: string; allowed: boolean; actor?: string }): Promise<GroupAccessState>;
  setChatMode(input: { tenantId: string; waGroupId: string; mode: GroupChatMode; actor?: string }): Promise<GroupAccessState>;
  updateSettings(input: { tenantId: string; waGroupId: string; settings: Partial<GroupAccessState>; actor?: string }): Promise<GroupAccessState>;
  listAllowed(tenantId: string): Promise<GroupAccessState[]>;
}

export interface AdminAccessPort {
  add(input: { tenantId: string; waUserId: string; displayName?: string | null; actor?: string }): Promise<{
    waUserId: string;
    displayName?: string | null;
    phoneNumber?: string | null;
    permissionRole?: string | null;
  }>;
  remove(input: { tenantId: string; waUserId: string; actor?: string }): Promise<boolean>;
  list(tenantId: string): Promise<
    Array<{ waUserId: string; displayName?: string | null; phoneNumber?: string | null; permissionRole?: string | null; createdAt?: Date }>
  >;
  isAdmin(input: { tenantId: string; waUserId: string }): Promise<boolean>;
}

export interface FlagsRepositoryPort {
  resolveFlags(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<Record<string, string>>;
}

export interface TriggersRepositoryPort {
  findActiveByScope(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<TriggerRule[]>;
}

export interface TasksRepositoryPort {
  addTask(input: {
    tenantId: string;
    title: string;
    createdByWaUserId: string;
    waGroupId?: string;
    runAt?: Date | null;
  }): Promise<{ id: string; publicId: string; title: string }>;
  listTasks(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<TaskListItem[]>;
  listTasksForDay(input: { tenantId: string; waGroupId?: string; waUserId?: string; dayStart: Date; dayEnd: Date }): Promise<TaskListItem[]>;
  markDone(input: { tenantId: string; taskRef: string; waGroupId?: string; waUserId?: string }): Promise<{ ok: boolean; id?: string; publicId?: string }>;
  updateTask?(input: {
    tenantId: string;
    taskId: string;
    title?: string;
    runAt?: Date | null;
    waGroupId?: string;
    waUserId?: string;
  }): Promise<{ id: string; title: string; runAt?: Date | null } | null>;
  deleteTask?(input: { tenantId: string; taskId: string; waGroupId?: string; waUserId?: string }): Promise<boolean>;
  countOpen(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<number>;
}

export interface RemindersRepositoryPort {
  createReminder(input: ReminderCreateInput): Promise<ReminderRecord>;
  listForDay(input: { tenantId: string; waGroupId?: string; waUserId: string; dayStart: Date; dayEnd: Date }): Promise<ReminderRecord[]>;
  updateReminder?(input: {
    tenantId: string;
    reminderId: string;
    waGroupId?: string;
    waUserId?: string;
    message?: string;
    remindAt?: Date;
  }): Promise<ReminderRecord | null>;
  deleteReminder?(input: { tenantId: string; reminderId: string; waGroupId?: string; waUserId?: string }): Promise<ReminderRecord | null>;
  countScheduled(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<number>;
}

export interface NotesRepositoryPort {
  addNote(input: { tenantId: string; waGroupId?: string; waUserId: string; text: string; scope: Scope }): Promise<NoteRecord>;
  listNotes(input: { tenantId: string; waGroupId?: string; waUserId: string; scope: Scope; limit?: number }): Promise<NoteRecord[]>;
  removeNote(input: { tenantId: string; waGroupId?: string; waUserId: string; publicId: string }): Promise<boolean>;
}

export interface TimersRepositoryPort {
  createTimer(input: TimerCreateInput): Promise<TimerRecord>;
  getTimerById(id: string): Promise<TimerRecord | null>;
  countScheduled(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<number>;
}

export interface MessagesRepositoryPort {
  getRecentMessages(input: { tenantId: string; waGroupId?: string; waUserId: string; limit: number }): Promise<ConversationMessage[]>;
}

export interface ConversationMemoryItem {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  metadataJson?: unknown;
  createdAt: Date;
}

export interface ConversationMemoryPort {
  appendMemory(input: {
    tenantId: string;
    conversationId: string;
    waUserId?: string;
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    metadataJson?: unknown;
    keepLatest?: number;
  }): Promise<void>;
  listRecentMemory(input: { conversationId: string; limit: number }): Promise<ConversationMemoryItem[]>;
  trimOldMemory?(conversationId: string, keepLatestN: number): Promise<void>;
  clearMemory?(conversationId: string): Promise<void>;
}

export interface CooldownPort {
  canFire(key: string, ttlSeconds: number): Promise<boolean>;
}

export interface RateLimitPort {
  allow(key: string, max: number, windowSeconds: number): Promise<boolean>;
}

export interface ConversationStatePort {
  getState(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<ConversationStateRecord | null>;
  setState(input: {
    tenantId: string;
    waGroupId?: string;
    waUserId: string;
    state: ConversationState;
    context?: Record<string, unknown>;
    expiresAt?: Date | null;
  }): Promise<void>;
  clearState(input: { tenantId: string; waGroupId?: string; waUserId: string }): Promise<void>;
}

export interface ConsentPort {
  getConsent(input: { tenantId: string; waUserId: string; termsVersion?: string }): Promise<UserConsentRecord | null>;
  setConsentStatus(input: {
    tenantId: string;
    waUserId: string;
    status: ConsentStatus;
    termsVersion: string;
    source?: string;
    timestamp?: Date;
  }): Promise<UserConsentRecord>;
}

export interface QueuePort {
  enqueueReminder(reminderId: string, runAt: Date): Promise<{ jobId: string }>;
  enqueueTimer(timerId: string, runAt: Date): Promise<{ jobId: string }>;
}

export interface LlmPort {
  chat(input: { system: string; messages: ConversationMessage[] }): Promise<string>;
}

export interface TextToSpeechPort {
  synthesize(input: {
    text: string;
    language: string;
    voice: string;
    timeoutMs?: number;
  }): Promise<{
    audioBase64: string;
    mimeType: string;
    provider?: string;
    model?: string;
    voice?: string;
    language?: string;
  }>;
}

export interface WebSearchResultItem {
  title: string;
  snippet?: string;
  link: string;
}

export interface ImageSearchResultItem {
  title: string;
  link: string;
  imageUrl?: string;
}

export interface WebSearchPort {
  search(input: {
    query: string;
    limit: number;
    locale?: string;
  }): Promise<{
    provider: string;
    results: WebSearchResultItem[];
  }>;
}

export interface ImageSearchPort {
  search(input: {
    query: string;
    limit: number;
    locale?: string;
  }): Promise<{
    provider: string;
    results: ImageSearchResultItem[];
  }>;
}

export type MediaDownloadProvider = "yt" | "ig" | "fb" | "direct";

export interface MediaDownloadPort {
  resolve(input: {
    provider: MediaDownloadProvider;
    url: string;
    tenantId?: string;
    waUserId?: string;
    waGroupId?: string;
  }): Promise<{
    provider: MediaDownloadProvider;
    status: "ready" | "unsupported" | "blocked" | "invalid" | "error";
    reason?: string;
    title?: string;
    url?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
}

export interface PromptPort {
  resolvePrompt(input: { tenantId: string; waGroupId?: string }): Promise<string | null>;
}

export interface MutePort {
  getMuteState(input: { tenantId: string; scope: Scope; scopeId: string; waUserId?: string }): Promise<{ until: Date } | null>;
  mute(input: { tenantId: string; scope: Scope; scopeId: string; durationMs: number; now: Date; waUserId?: string }): Promise<{ until: Date }>;
  unmute(input: { tenantId: string; scope: Scope; scopeId: string; waUserId?: string }): Promise<void>;
}

export interface IdentityPort {
  getIdentity(input: {
    tenantId: string;
    waUserId: string;
    waGroupId?: string;
  }): Promise<{
    displayName?: string | null;
    role: string;
    permissionRole?: string | null;
    permissions: string[];
    groupName?: string;
    canonicalIdentity?: CanonicalIdentity;
    relationshipProfile?: RelationshipProfile | null;
    relationshipReason?: string | null;
  }>;
  linkAlias?(input: {
    tenantId: string;
    phoneNumber: string;
    lidJid: string;
    actor?: string;
  }): Promise<{
    canonicalIdentity: CanonicalIdentity;
    relationshipProfile?: RelationshipProfile | null;
    permissionRole?: string | null;
  }>;
}

export interface StatusPort {
  getStatus(input: { tenantId: string; waGroupId?: string; waUserId?: string }): Promise<StatusSnapshot>;
}

export interface ClockPort {
  now(): Date;
}

export interface LoggerPort {
  debug?(obj: unknown, msg?: string, ...args: unknown[]): void;
  info?(obj: unknown, msg?: string, ...args: unknown[]): void;
  warn(obj: unknown, msg?: string, ...args: unknown[]): void;
  error?(obj: unknown, msg?: string, ...args: unknown[]): void;
}

export interface MetricsPort {
  increment(key: MetricKey, by?: number): Promise<void>;
}

export interface AuditPort {
  record(event: AuditEvent): Promise<void>;
}

export interface CorePorts {
  flagsRepository: FlagsRepositoryPort;
  triggersRepository: TriggersRepositoryPort;
  tasksRepository: TasksRepositoryPort;
  remindersRepository: RemindersRepositoryPort;
  notesRepository?: NotesRepositoryPort;
  timersRepository?: TimersRepositoryPort;
  messagesRepository: MessagesRepositoryPort;
  conversationMemory?: ConversationMemoryPort;
  aiAssistant?: AiAssistantPort;
  prompt: PromptPort;
  cooldown: CooldownPort;
  rateLimit: RateLimitPort;
  queue: QueuePort;
  llm: LlmPort;
  textToSpeech?: TextToSpeechPort;
  webSearch?: WebSearchPort;
  imageSearch?: ImageSearchPort;
  mediaDownload?: MediaDownloadPort;
  llmModel?: string;
  mute?: MutePort;
  identity?: IdentityPort;
  groupAccess?: GroupAccessPort;
  adminAccess?: AdminAccessPort;
  status?: StatusPort;
  conversationState?: ConversationStatePort;
  consent: ConsentPort;
  clock?: ClockPort;
  logger?: LoggerPort;
  botName?: string;
  defaultAssistantMode?: "off" | "professional" | "fun" | "mixed";
  defaultFunMode?: "off" | "on";
  llmEnabled?: boolean;
  timezone?: string;
  commandPrefix?: string;
  defaultReminderTime?: string;
  baseSystemPrompt?: string;
  llmMemoryMessages?: number;
  ttsEnabled?: boolean;
  ttsDefaultLanguage?: string;
  ttsDefaultVoice?: string;
  ttsMaxTextChars?: number;
  searchResultsLimit?: number;
  imageSearchResultsLimit?: number;
  audioCapabilityEnabled?: boolean;
  audioAutoTranscribeEnabled?: boolean;
  audioCommandDispatchEnabled?: boolean;
  consentTermsVersion?: string;
  consentLink?: string;
  consentSource?: string;
  metrics?: MetricsPort;
  audit?: AuditPort;
}
