import type { ModerationAction } from "../../../../pipeline/actions.js";

export interface ModerationActionInput {
  waGroupId: string;
  targetWaUserId?: string;
  durationMs?: number;
  text?: string;
  messageKey?: { id: string; remoteJid?: string; fromMe?: boolean; participant?: string };
}

export const banUserAction = (input: ModerationActionInput): ModerationAction => ({
  kind: "moderation_action",
  action: "ban",
  waGroupId: input.waGroupId,
  targetWaUserId: input.targetWaUserId
});

export const kickUserAction = (input: ModerationActionInput): ModerationAction => ({
  kind: "moderation_action",
  action: "kick",
  waGroupId: input.waGroupId,
  targetWaUserId: input.targetWaUserId
});

export const muteUserAction = (input: ModerationActionInput): ModerationAction => ({
  kind: "moderation_action",
  action: "mute",
  waGroupId: input.waGroupId,
  targetWaUserId: input.targetWaUserId,
  durationMs: input.durationMs
});

export const unmuteUserAction = (input: ModerationActionInput): ModerationAction => ({
  kind: "moderation_action",
  action: "unmute",
  waGroupId: input.waGroupId,
  targetWaUserId: input.targetWaUserId
});

export const hideTagAction = (input: ModerationActionInput): ModerationAction => ({
  kind: "moderation_action",
  action: "hidetag",
  waGroupId: input.waGroupId,
  text: input.text
});
