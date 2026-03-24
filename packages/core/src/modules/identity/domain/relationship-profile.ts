import type { RelationshipProfile } from "../../../pipeline/types.js";

export const CREATOR_WA_NUMBER = "556699064658";
export const MOTHER_WA_NUMBER = "556692283438";

const normalizeWaNumber = (value?: string | null): string => value?.replace(/\D/g, "") ?? "";

export const hasRootPrivileges = (input: {
  permissionRole?: string | null;
  role?: string | null;
  relationshipProfile?: RelationshipProfile | null;
}): boolean => {
  const role = (input.permissionRole ?? input.role ?? "").toUpperCase();
  return role === "ROOT" || role === "DONO" || input.relationshipProfile === "creator_root";
};

const matchPrivilegedNumber = (candidates: string[]): { profile: RelationshipProfile; reason: string } | null => {
  const normalized = candidates.map((candidate) => normalizeWaNumber(candidate)).filter(Boolean);
  if (normalized.includes(CREATOR_WA_NUMBER)) return { profile: "creator_root", reason: "match:creator_number" };
  if (normalized.includes(MOTHER_WA_NUMBER)) return { profile: "mother_privileged", reason: "match:mother_number" };
  return null;
};

export const resolveRelationshipProfile = (input: {
  waUserId: string;
  phoneNumber?: string | null;
  pnJid?: string | null;
  lidJid?: string | null;
  aliases?: string[];
  identityRole?: string;
  storedProfile?: RelationshipProfile | null;
}): {
  profile: RelationshipProfile;
  reason: string;
} => {
  const candidates = [input.phoneNumber, input.pnJid, input.lidJid, input.waUserId, ...(input.aliases ?? [])].filter(Boolean) as string[];
  const privileged = matchPrivilegedNumber(candidates);
  if (privileged) {
    if (input.storedProfile && input.storedProfile !== privileged.profile) {
      return { profile: privileged.profile, reason: `${privileged.reason}_override_stored` };
    }
    return privileged;
  }

  if (input.storedProfile) return { profile: input.storedProfile, reason: "stored_profile" };

  const role = input.identityRole?.toUpperCase?.();
  if (role === "ROOT" || role === "DONO") return { profile: "delegated_owner", reason: "role:owner" };
  if (role === "ADMIN" || role === "GROUP_ADMIN") return { profile: "admin", reason: "role:admin" };

  return { profile: "member", reason: "default_member" };
};
