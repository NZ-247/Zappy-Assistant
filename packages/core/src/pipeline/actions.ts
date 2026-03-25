import type { ToolIntent } from "./types.js";

export interface ReplyTextAction {
  kind: "reply_text";
  text: string;
}

export interface ReplyListItem {
  title: string;
  description?: string;
}

export interface ReplyListAction {
  kind: "reply_list";
  header?: string;
  items: ReplyListItem[];
  footer?: string;
}

export interface EnqueueJobAction {
  kind: "enqueue_job";
  jobType: "reminder" | "timer" | string;
  payload: { id: string; runAt?: Date; [key: string]: unknown };
}

export interface NoopAction {
  kind: "noop";
  reason?: string;
}

export interface ErrorAction {
  kind: "error";
  message: string;
  reason?: string;
}

export interface HandoffAction {
  kind: "handoff";
  target: "human" | "agent";
  note?: string;
}

export interface AiToolSuggestionAction {
  kind: "ai_tool_suggestion";
  tool: ToolIntent;
  text?: string;
}

export type StickerTransformOperation = "media_to_sticker" | "image_to_sticker" | "sticker_to_image" | "sticker_rename_metadata";
export type StickerTransformSource = "inbound" | "quoted";
export type StickerSourceMediaType = "image" | "video";

export interface StickerTransformAction {
  kind: "sticker_transform";
  operation: StickerTransformOperation;
  source: StickerTransformSource;
  sourceMediaType?: StickerSourceMediaType;
  author?: string;
  packName?: string;
}

export type AudioTranscriptionSource = "inbound" | "quoted";
export type AudioTranscriptionMode = "transcribe_only" | "transcribe_and_route";

export interface AudioTranscriptionAction {
  kind: "audio_transcription";
  source: AudioTranscriptionSource;
  mode: AudioTranscriptionMode;
  allowCommandDispatch?: boolean;
  commandPrefix?: string;
  origin?: "command" | "auto";
}

export type GroupAdminOperation =
  | "set_subject"
  | "set_description"
  | "set_picture_from_quote"
  | "set_open"
  | "set_closed";

export interface GroupAdminAction {
  kind: "group_admin_action";
  operation: GroupAdminOperation;
  waGroupId: string;
  actorWaUserId: string;
  text?: string;
  quotedWaMessageId?: string;
}

export type ModerationActionKind = "ban" | "kick" | "mute" | "unmute" | "hidetag" | "delete_message";

export interface ModerationAction {
  kind: "moderation_action";
  action: ModerationActionKind;
  waGroupId: string;
  targetWaUserId?: string;
  durationMs?: number;
  text?: string;
  messageKey?: { id: string; remoteJid?: string; fromMe?: boolean; participant?: string };
}

export type ResponseAction =
  | ReplyTextAction
  | ReplyListAction
  | StickerTransformAction
  | AudioTranscriptionAction
  | EnqueueJobAction
  | NoopAction
  | ErrorAction
  | HandoffAction
  | AiToolSuggestionAction
  | GroupAdminAction
  | ModerationAction;

export type OrchestratorAction = ResponseAction;
