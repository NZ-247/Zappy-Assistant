const normalizePrefix = (value?: string): string => {
  const prefix = value?.trim();
  return prefix && prefix.length > 0 ? prefix : "/";
};

export const createCommandGuards = (prefixInput?: string) => {
  const commandPrefix = normalizePrefix(prefixInput);

  const stripCommandPrefix = (text: string): string => {
    const trimmed = text.trim();
    return trimmed.startsWith(commandPrefix) ? trimmed.slice(commandPrefix.length) : trimmed;
  };

  const hasCommandPrefix = (text: string): boolean => text.trim().startsWith(commandPrefix);

  const isBotAdminCommand = (text: string): boolean => {
    if (!hasCommandPrefix(text)) return false;
    const lower = stripCommandPrefix(text).toLowerCase();
    if (lower.startsWith("chat ")) return true;
    if (lower.startsWith("set gp ")) return true;
    if (lower === "add gp allowed_groups") return true;
    if (lower === "rm gp allowed_groups") return true;
    if (lower.startsWith("ban") || lower.startsWith("kick") || lower.startsWith("hidetag") || lower.startsWith("unmute")) return true;
    if (lower.startsWith("mute ")) return true;
    return false;
  };

  const isGroupAdminCommand = (text: string): boolean => {
    if (!hasCommandPrefix(text)) return false;
    const lower = stripCommandPrefix(text).toLowerCase();
    return (
      lower.startsWith("set gp ") ||
      lower.startsWith("add gp allowed_groups") ||
      lower.startsWith("rm gp allowed_groups") ||
      lower.startsWith("add user admins") ||
      lower.startsWith("rm user admins") ||
      lower.startsWith("list user admins") ||
      lower.startsWith("chat ") ||
      lower.startsWith("ban") ||
      lower.startsWith("kick") ||
      lower.startsWith("mute ") ||
      lower.startsWith("unmute") ||
      lower.startsWith("hidetag")
    );
  };

  return {
    commandPrefix,
    stripCommandPrefix,
    hasCommandPrefix,
    isBotAdminCommand,
    isGroupAdminCommand
  };
};
