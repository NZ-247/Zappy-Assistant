import type { GroupChatMode, GroupFunMode, GroupModerationSettings } from "../../../pipeline/types.js";

export type GroupSettingsUpdate = Partial<{
  chatMode: GroupChatMode;
  isOpen: boolean;
  welcomeEnabled: boolean;
  welcomeText: string | null;
  fixedMessageText: string | null;
  rulesText: string | null;
  funMode: GroupFunMode | null;
  moderation: GroupModerationSettings;
  groupName: string | null;
  description: string | null;
}>;
