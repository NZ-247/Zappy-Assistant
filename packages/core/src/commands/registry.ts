import type { CommandDefinition, CommandMatch, CommandRegistry } from "./types.js";
import { hasCommandPrefix, normalizeCommandPrefix, stripCommandPrefix } from "./utils.js";

const COMMANDS: CommandDefinition[] = [
  {
    name: "help",
    aliases: ["ajuda"],
    scope: "both",
    description: "Lista comandos disponíveis e contexto do chat.",
    usage: "help"
  },
  {
    name: "ping",
    scope: "both",
    description: "Verifica a latência do bot.",
    usage: "ping"
  },
  {
    name: "groupinfo",
    scope: "group",
    description: "Mostra informações básicas do grupo.",
    usage: "groupinfo"
  },
  {
    name: "rules",
    scope: "group",
    description: "Exibe as regras configuradas do grupo.",
    usage: "rules"
  },
  {
    name: "fix",
    aliases: ["fixed"],
    scope: "group",
    description: "Mostra a mensagem fixa configurada no grupo.",
    usage: "fix"
  },
  {
    name: "chat",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Liga ou desliga o chat do bot no grupo.",
    usage: "chat on|off"
  },
  {
    name: "set gp",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Ajusta configurações do grupo (chat, open/close, name, dcr, img, fix, rules, welcome).",
    usage: "set gp <chat|open|close|name|dcr|img|fix|rules|welcome> ..."
  },
  {
    name: "add gp allowed_groups",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Autoriza o grupo a usar o bot.",
    usage: "add gp allowed_groups"
  },
  {
    name: "rm gp allowed_groups",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Remove o grupo da lista de permitidos.",
    usage: "rm gp allowed_groups"
  },
  {
    name: "list gp allowed_groups",
    scope: "both",
    requiredRole: "admin",
    description: "Lista grupos autorizados.",
    usage: "list gp allowed_groups"
  },
  {
    name: "add user admins",
    scope: "both",
    requiredRole: "admin",
    description: "Adiciona um usuário à lista de admins do bot.",
    usage: "add user admins <@>",
    botAdminRequired: false
  },
  {
    name: "rm user admins",
    scope: "both",
    requiredRole: "admin",
    description: "Remove um usuário da lista de admins do bot.",
    usage: "rm user admins <@>"
  },
  {
    name: "list user admins",
    scope: "both",
    requiredRole: "admin",
    description: "Lista admins do bot.",
    usage: "list user admins"
  },
  {
    name: "ban",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Bane um usuário do grupo.",
    usage: "ban <@>"
  },
  {
    name: "kick",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Remove um usuário do grupo.",
    usage: "kick <@>"
  },
  {
    name: "mute",
    scope: "both",
    requiredRole: "member",
    botAdminRequired: false,
    description: "Silencia escopo atual ou um membro no grupo.",
    usage: "mute [@user] <duration>|off"
  },
  {
    name: "unmute",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Reativa um usuário no grupo.",
    usage: "unmute <@>"
  },
  {
    name: "hidetag",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Envia mensagem com menção oculta a todos.",
    usage: "hidetag <texto>"
  },
  {
    name: "task add",
    scope: "both",
    description: "Cria uma nova tarefa.",
    usage: "task add <title>"
  },
  {
    name: "task list",
    scope: "both",
    description: "Lista tarefas.",
    usage: "task list"
  },
  {
    name: "task done",
    scope: "both",
    description: "Marca uma tarefa como concluída.",
    usage: "task done <id>"
  },
  {
    name: "note add",
    scope: "both",
    description: "Adiciona uma nota.",
    usage: "note add <text>"
  },
  {
    name: "note list",
    scope: "both",
    description: "Lista notas.",
    usage: "note list"
  },
  {
    name: "note rm",
    scope: "both",
    description: "Remove uma nota pelo ID público.",
    usage: "note rm <id>"
  },
  {
    name: "agenda",
    scope: "both",
    description: "Mostra tarefas e lembretes do dia.",
    usage: "agenda"
  },
  {
    name: "calc",
    scope: "both",
    description: "Calculadora simples.",
    usage: "calc <expression>"
  },
  {
    name: "timer",
    scope: "both",
    description: "Cria um timer curto.",
    usage: "timer <duration>"
  },
  {
    name: "alias link",
    scope: "both",
    requiredRole: "admin",
    description: "Vincula número e LID a um usuário (root/admin).",
    usage: "alias link <phoneNumber> <lidJid>"
  },
  {
    name: "whoami",
    scope: "both",
    description: "Mostra suas permissões e contexto.",
    usage: "whoami"
  },
  {
    name: "userinfo",
    scope: "group",
    description: "Mostra informações de um usuário mencionado ou respondido.",
    usage: "userinfo <reply|@mention>"
  },
  {
    name: "status",
    scope: "both",
    description: "Mostra status operacional.",
    usage: "status"
  },
  {
    name: "reminder",
    scope: "both",
    description: "Agenda um lembrete.",
    usage: "reminder in <duration> <message> | reminder at <DD-MM[-YYYY]> [HH:MM] <message>"
  }
];

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
  { name: "note add", match: /^note\s+add\b/i },
  { name: "note list", match: /^note\s+list\b/i },
  { name: "note rm", match: /^note\s+rm\b/i },
  { name: "agenda", match: /^agenda\b/i },
  { name: "calc", match: /^calc\b/i },
  { name: "timer", match: /^timer\b/i },
  { name: "alias link", match: /^alias\s+link\b/i },
  { name: "whoami", match: /^whoami\b/i },
  { name: "userinfo", match: /^userinfo\b/i },
  { name: "status", match: /^status\b/i },
  { name: "reminder", match: /^reminder\b/i }
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
