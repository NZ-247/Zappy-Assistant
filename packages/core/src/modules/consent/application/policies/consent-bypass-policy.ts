import type { RelationshipProfile } from "../../../../pipeline/types.js";

export const shouldBypassConsent = (input: {
  permissionRole?: string | null;
  role?: string | null;
  relationshipProfile?: RelationshipProfile | null;
}): boolean => {
  const role = (input.permissionRole ?? input.role ?? "").toUpperCase();
  const privilegedRoles = ["ROOT", "DONO", "OWNER", "ADMIN", "PRIVILEGED", "INTERNAL"];
  if (privilegedRoles.includes(role)) return true;

  return ["creator_root", "mother_privileged", "delegated_owner"].includes(input.relationshipProfile ?? "");
};
