import type { GroupAccessPort, GroupAccessState } from "../../ports.js";

export const listAllowedGroups = async (
  groupAccess: GroupAccessPort,
  tenantId: string
): Promise<GroupAccessState[]> => {
  return groupAccess.listAllowed(tenantId);
};
