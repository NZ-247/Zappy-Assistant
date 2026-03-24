import type { GroupAccessPort, GroupAccessState, GroupChatMode } from "../../ports.js";

export interface SetGroupChatModeInput {
  tenantId: string;
  waGroupId: string;
  mode: GroupChatMode;
  actor?: string;
}

export const setGroupChatMode = async (
  groupAccess: GroupAccessPort,
  input: SetGroupChatModeInput
): Promise<GroupAccessState> => {
  return groupAccess.setChatMode({
    tenantId: input.tenantId,
    waGroupId: input.waGroupId,
    mode: input.mode,
    actor: input.actor
  });
};
