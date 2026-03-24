export interface ParsedSetGroupCommand {
  subCommand: string;
  tokens: string[];
  trailingText: string;
}

export const parseSetGroupCommand = (commandText: string): ParsedSetGroupCommand => {
  const args = commandText.replace(/^set gp\s+/i, "");
  const [subCommandRaw, ...tokens] = args.split(/\s+/);
  const trailingText = args.replace(/^\S+\s*/, "").trim();
  return {
    subCommand: (subCommandRaw ?? "").toLowerCase(),
    tokens,
    trailingText
  };
};
