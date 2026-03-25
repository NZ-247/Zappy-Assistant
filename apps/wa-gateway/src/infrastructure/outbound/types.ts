import type { SpeechToTextPort } from "@zappy/core";

export interface SendWithReplyFallbackInput {
  to: string;
  content: any;
  quotedMessage?: any;
  logContext: Record<string, unknown>;
}

export interface ProgressReactionsConfig {
  enabled: boolean;
  processingEmoji: string;
  successEmoji: string;
  failureEmoji: string;
}

export interface AudioRuntimeConfig {
  enabled: boolean;
  sttModel: string;
  sttTimeoutMs: number;
  maxDurationSeconds: number;
  maxBytes: number;
  language?: string;
  commandDispatchEnabled: boolean;
  commandPrefix: string;
  commandAllowlist: string[];
  commandMinConfidence: number;
  transcriptPreviewChars: number;
}

export interface DispatchTranscribedTextInput {
  text: string;
  transcript: string;
  commandText?: string;
  action: "respond" | "dispatch_command";
}

export interface DispatchTranscribedTextResult {
  hadResponses: boolean;
  dispatchExecutionId?: string;
}

export interface ExecuteOutboundActionsInput {
  actions: any[];
  isGroup: boolean;
  remoteJid: string;
  waUserId: string;
  event: any;
  message: any;
  context: any;
  contextInfo?: any;
  quotedWaMessageId?: string;
  quotedWaUserId?: string;
  canonical?: {
    phoneNumber?: string | null;
  } | null;
  normalizedPhone?: string;
  relationshipProfile?: string | null;
  permissionRole?: string | null;
  timezone: string;
  commandPrefix: string;
  progressReactions: ProgressReactionsConfig;
  audioConfig: AudioRuntimeConfig;
  speechToText?: SpeechToTextPort;
  dispatchTranscribedText: (input: DispatchTranscribedTextInput) => Promise<DispatchTranscribedTextResult>;
  sendWithReplyFallback: (input: SendWithReplyFallbackInput) => Promise<any>;
  persistOutboundMessage: (input: any) => Promise<unknown>;
  queueAdapter: {
    enqueueReminder: (reminderId: string, runAt: Date) => Promise<unknown>;
    enqueueTimer: (timerId: string, runAt: Date) => Promise<unknown>;
  };
  groupAccessRepository: {
    getGroupAccess: (input: any) => Promise<any>;
    updateSettings: (input: any) => Promise<any>;
  };
  muteAdapter: {
    mute: (input: any) => Promise<{ until: Date }>;
    unmute: (input: any) => Promise<void>;
  };
  attemptGroupAdminAction: (input: {
    actionName: string;
    groupJid: string;
    run: () => Promise<unknown>;
  }) => Promise<{ kind: string; errorMessage?: string }>;
  getSocket: () => any | null;
  downloadMediaMessage: (message: any, type: "buffer" | "stream", options: any, ctx?: any) => Promise<unknown>;
  baileysLogger: any;
  normalizeJid: (value: string) => string;
  logger: {
    debug?: (payload: unknown, message?: string) => void;
    info?: (payload: unknown, message?: string) => void;
    warn?: (payload: unknown, message?: string) => void;
  };
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  metrics: { increment: (key: any, by?: number) => Promise<void> };
  auditTrail: { record: (event: any) => Promise<void> };
  stickerMaxVideoSeconds: number;
}

export type OutboundScope = "group" | "direct";
