import type { CommandDefinition, CommandMatch, CommandRegistry } from "./command-types.js";
import { allCommands } from "./command-groups.js";
import { hasCommandPrefix, normalizeCommandPrefix, stripCommandPrefix } from "../parser/prefix.js";

const COMMANDS: CommandDefinition[] = allCommands;

const COMMAND_MATCHERS: Array<{ match: RegExp; name: string }> = [
  { name: "help", match: /^help\b/i },
  { name: "help", match: /^ajuda\b/i },
  { name: "ping", match: /^ping\b/i },
  { name: "groupinfo", match: /^groupinfo\b/i },
  { name: "rules", match: /^rules\b/i },
  { name: "fix", match: /^fix(ed)?\b/i },
  { name: "chat", match: /^chat\s+(on|off)\b/i },
  { name: "set gp", match: /^set\s+gp\b/i },
  { name: "add gp allowed_groups", match: /^add\s+gp\s+allowed_groups\b/i },
  { name: "rm gp allowed_groups", match: /^rm\s+gp\s+allowed_groups\b/i },
  { name: "list gp allowed_groups", match: /^list\s+gp\s+allowed_groups\b/i },
  { name: "add user admins", match: /^add\s+user\s+admins\b/i },
  { name: "rm user admins", match: /^rm\s+user\s+admins\b/i },
  { name: "list user admins", match: /^list\s+user\s+admins\b/i },
  { name: "ban", match: /^ban\b/i },
  { name: "kick", match: /^kick\b/i },
  { name: "mute", match: /^mute\b/i },
  { name: "unmute", match: /^unmute\b/i },
  { name: "hidetag", match: /^hidetag\b/i },
  { name: "task add", match: /^task\s+add\b/i },
  { name: "task list", match: /^task\s+list\b/i },
  { name: "task done", match: /^task\s+done\b/i },
  { name: "note rm", match: /^(note|notes)\s+rm\b/i },
  { name: "note list", match: /^(?:note\s+list|notes(?:\s+list)?)(?:\s+)?$/i },
  { name: "note add", match: /^note\b(?!\s+(list|rm)\b)/i },
  { name: "note add", match: /^notes\s+add\b/i },
  { name: "agenda", match: /^agenda\b/i },
  { name: "calc", match: /^calc\b/i },
  { name: "timer", match: /^timer\b/i },
  { name: "alias link", match: /^alias\s+link\b/i },
  { name: "whoami", match: /^whoami\b/i },
  { name: "userinfo", match: /^userinfo\b/i },
  { name: "status", match: /^status\b/i },
  { name: "transcribe", match: /^(transcribe|tr)\b/i },
  { name: "reminder", match: /^reminder\b/i },
  { name: "tts", match: /^tts\b/i },
  { name: "search", match: /^search\b/i },
  { name: "search", match: /^google\b/i },
  { name: "search-ai", match: /^search-ai\b/i },
  { name: "search-ai", match: /^sai\b/i },
  { name: "img", match: /^img\b/i },
  { name: "img", match: /^gimage\b/i },
  { name: "dl", match: /^dl\b/i }
];

export const createCommandRegistry = (prefix?: string): CommandRegistry => {
  const activePrefix = normalizeCommandPrefix(prefix);
  const index = new Map<string, CommandDefinition>();
  for (const def of COMMANDS) {
    index.set(def.name.toLowerCase(), def);
    def.aliases?.forEach((alias) => index.set(alias.toLowerCase(), def));
  }

  const find = (nameOrAlias: string): CommandDefinition | undefined => index.get(nameOrAlias.toLowerCase());

  const resolve = (text: string): CommandMatch | null => {
    const trimmed = text.trim();
    if (!hasCommandPrefix(trimmed, activePrefix)) return null;
    const body = stripCommandPrefix(trimmed, activePrefix);
    const lowerBody = body.toLowerCase();
    const token = lowerBody.split(/\s+/)[0] ?? "";

    const byToken = find(token);
    if (byToken) {
      const matchedAlias = byToken.aliases?.find((alias) => alias.toLowerCase() === token);
      return { input: text, command: byToken, matchedAlias };
    }

    for (const matcher of COMMAND_MATCHERS) {
      if (matcher.match.test(lowerBody)) {
        const command = find(matcher.name);
        if (command) return { input: text, command, matchedAlias: matcher.name === command.name ? undefined : matcher.name };
      }
    }

    return null;
  };

  return {
    prefix: activePrefix,
    list: () => [...COMMANDS],
    find,
    resolve
  };
};

export const defaultCommands = COMMANDS;
