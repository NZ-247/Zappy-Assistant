import type { GroupAccessPort, GroupAccessState } from "../../ports.js";
import type { GroupSettingsUpdate } from "../../domain/group-settings.js";

export interface UpdateGroupSettingsInput {
  tenantId: string;
  waGroupId: string;
  settings: GroupSettingsUpdate;
  actor?: string;
}

export const updateGroupSettings = async (
  groupAccess: GroupAccessPort,
  input: UpdateGroupSettingsInput
): Promise<GroupAccessState> => {
  return groupAccess.updateSettings({
    tenantId: input.tenantId,
    waGroupId: input.waGroupId,
    settings: input.settings as Partial<GroupAccessState>,
    actor: input.actor
  });
};
