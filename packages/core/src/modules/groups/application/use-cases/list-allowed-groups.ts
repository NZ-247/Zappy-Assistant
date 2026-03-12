import type { GroupAccessPort, GroupAccessState } from "../../ports/group-access.port.js";

export const listAllowedGroups = async (
  groupAccess: GroupAccessPort,
  tenantId: string
): Promise<GroupAccessState[]> => {
  return groupAccess.listAllowed(tenantId);
};
