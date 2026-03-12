import type { CommandMatch, CommandRegistry } from "./types.js";
import { hasCommandPrefix, stripCommandPrefix } from "./utils.js";

export interface ParsedCommand {
  raw: string;
  body: string;
  lower: string;
  token: string;
  match: CommandMatch | null;
}

export const parseCommandText = (text: string, registry: CommandRegistry): ParsedCommand | null => {
  const trimmed = text.trim();
  if (!hasCommandPrefix(trimmed, registry.prefix)) return null;
  const body = stripCommandPrefix(trimmed, registry.prefix);
  const lower = body.toLowerCase();
  const token = lower.split(/\s+/)[0] ?? "";
  const match = registry.resolve(trimmed);
  return { raw: trimmed, body, lower, token, match };
};
