import { formatCommand } from "./parser/prefix.js";
import type { CommandCategory, CommandDefinition, CommandRegistry } from "./registry/command-types.js";
import type { RelationshipProfile } from "../pipeline/types.js";

export type HelpVisibilityContext = {
  isGroup: boolean;
  isAdmin: boolean;
  isRoot: boolean;
  isGroupAdmin: boolean;
  relationshipProfile?: RelationshipProfile | null;
  botIsGroupAdmin?: boolean;
};

const CATEGORY_ORDER: CommandCategory[] = [
  "core",
  "identity",
  "groups",
  "reminders",
  "tasks",
  "notes",
  "moderation",
  "admin",
  "system"
];

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  core: "Core",
  identity: "Identidade",
  groups: "Grupos",
  reminders: "Lembretes",
  tasks: "Tarefas",
  notes: "Notas",
  moderation: "Moderação",
  admin: "Admin",
  system: "Sistema"
};

const isPrivilegedProfile = (profile?: RelationshipProfile | null): boolean =>
  profile === "creator_root" || profile === "mother_privileged" || profile === "delegated_owner";

const matchesScope = (command: CommandDefinition, visibility: HelpVisibilityContext): boolean => {
  if (command.scope === "both") return true;
  return visibility.isGroup ? command.scope === "group" : command.scope === "direct";
};

const hasRoleAccess = (command: CommandDefinition, visibility: HelpVisibilityContext): boolean => {
  const required = command.requiredRole ?? "member";
  switch (required) {
    case "member":
      return true;
    case "admin":
      return visibility.isAdmin || visibility.isRoot;
    case "group_admin":
      return (visibility.isGroup && visibility.isGroupAdmin) || visibility.isAdmin || visibility.isRoot;
    case "root":
      return visibility.isRoot;
    case "privileged":
      return visibility.isRoot || isPrivilegedProfile(visibility.relationshipProfile);
    default:
      return true;
  }
};

const formatTags = (command: CommandDefinition, visibility: HelpVisibilityContext): string => {
  const tags: string[] = [];
  if (command.requiredRole && command.requiredRole !== "member") tags.push(command.requiredRole.replace("_", " "));
  if (visibility.isGroup && command.botAdminRequired) {
    tags.push(visibility.botIsGroupAdmin === false ? "bot admin necessário" : "bot admin");
  }
  return tags.length > 0 ? ` [${tags.join(", ")}]` : "";
};

const describeCommand = (command: CommandDefinition, prefix: string, visibility: HelpVisibilityContext): string => {
  const usage = formatCommand(prefix, command.usage);
  const description = command.description ? ` — ${command.description}` : "";
  const tags = formatTags(command, visibility);
  return `${usage}${description}${tags}`;
};

export const buildCommandHelpLines = ({
  registry,
  prefix,
  visibility
}: {
  registry: CommandRegistry;
  prefix: string;
  visibility: HelpVisibilityContext;
}): string[] => {
  const grouped = new Map<CommandCategory, string[]>();

  for (const command of registry.list()) {
    if (!matchesScope(command, visibility)) continue;
    if (!hasRoleAccess(command, visibility)) continue;

    const category: CommandCategory = command.category ?? "core";
    const list = grouped.get(category) ?? [];
    list.push(`- ${describeCommand(command, prefix, visibility)}`);
    grouped.set(category, list);
  }

  const lines: string[] = [];
  const seen = new Set<CommandCategory>();

  for (const category of CATEGORY_ORDER) {
    const items = grouped.get(category);
    if (!items || items.length === 0) continue;
    lines.push(`${CATEGORY_LABELS[category]}:`);
    lines.push(...items);
    seen.add(category);
  }

  for (const [category, items] of grouped.entries()) {
    if (seen.has(category)) continue;
    lines.push(`${CATEGORY_LABELS[category] ?? category}:`);
    lines.push(...items);
  }

  return lines;
};

export const buildProfileNotice = (relationshipProfile?: RelationshipProfile | null, isRoot?: boolean): string | null => {
  if (isRoot) return "Contexto: ROOT/creator reconhecido. Você tem controle administrativo total.";
  if (relationshipProfile === "mother_privileged") return "Contexto: contato privilegiado (mãe). Respostas com cuidado extra.";
  if (relationshipProfile === "creator_root") return "Contexto: creator_root detectado. Respostas mais proativas.";
  return null;
};
