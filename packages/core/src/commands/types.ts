export type CommandScope = "direct" | "group" | "both";

export type CommandRequiredRole = "member" | "admin" | "root" | "group_admin" | "privileged";

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  scope: CommandScope;
  requiredRole?: CommandRequiredRole;
  botAdminRequired?: boolean;
  description: string;
  usage: string;
  examples?: string[];
  matchers?: RegExp[];
}

export interface CommandMatch {
  input: string;
  command: CommandDefinition;
  matchedAlias?: string;
}

export interface CommandRegistry {
  prefix: string;
  list(): CommandDefinition[];
  find(nameOrAlias: string): CommandDefinition | undefined;
  resolve(text: string): CommandMatch | null;
}
