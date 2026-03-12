import type { GroupAccessPort, GroupAccessState } from "../../ports/group-access.port.js";

export interface SetGroupAllowedInput {
  tenantId: string;
  waGroupId: string;
  allowed: boolean;
  actor?: string;
}

export const setGroupAllowed = async (
  groupAccess: GroupAccessPort,
  input: SetGroupAllowedInput
): Promise<GroupAccessState> => {
  return groupAccess.setAllowed({
    tenantId: input.tenantId,
    waGroupId: input.waGroupId,
    allowed: input.allowed,
    actor: input.actor
  });
};
