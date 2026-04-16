import type { CommandDefinition } from "./command-types.js";

export const coreCommands: CommandDefinition[] = [
  {
    category: "core",
    name: "help",
    aliases: ["ajuda"],
    capability: "command.help",
    scope: "both",
    description: "Lista comandos disponíveis e contexto do chat.",
    usage: "help"
  },
  {
    category: "core",
    name: "ping",
    capability: "command.ping",
    scope: "both",
    description: "Verifica a latência do bot.",
    usage: "ping"
  },
  {
    category: "core",
    name: "calc",
    scope: "both",
    description: "Calculadora simples.",
    usage: "calc <expression>"
  },
  {
    category: "system",
    name: "status",
    capability: "command.status",
    scope: "both",
    description: "Mostra status operacional.",
    usage: "status"
  }
];

export const groupCommands: CommandDefinition[] = [
  {
    category: "groups",
    name: "groupinfo",
    scope: "group",
    description: "Mostra informações básicas do grupo.",
    usage: "groupinfo"
  },
  {
    category: "groups",
    name: "rules",
    scope: "group",
    description: "Exibe as regras configuradas do grupo.",
    usage: "rules"
  },
  {
    category: "groups",
    name: "fix",
    aliases: ["fixed"],
    scope: "group",
    description: "Mostra a mensagem fixa configurada no grupo.",
    usage: "fix"
  },
  {
    category: "groups",
    name: "chat",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Liga ou desliga o chat do bot no grupo.",
    usage: "chat on|off"
  },
  {
    category: "groups",
    name: "set gp",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Ajusta configurações do grupo (chat, open/close, name, dcr, img, fix, rules, welcome).",
    usage: "set gp <chat|open|close|name|dcr|img|fix|rules|welcome> ..."
  },
  {
    category: "groups",
    name: "add gp allowed_groups",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Autoriza o grupo a usar o bot.",
    usage: "add gp allowed_groups"
  },
  {
    category: "groups",
    name: "rm gp allowed_groups",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Remove o grupo da lista de permitidos.",
    usage: "rm gp allowed_groups"
  },
  {
    category: "groups",
    name: "list gp allowed_groups",
    scope: "both",
    requiredRole: "admin",
    description: "Lista grupos autorizados.",
    usage: "list gp allowed_groups"
  }
];

export const adminCommands: CommandDefinition[] = [
  {
    category: "admin",
    name: "add user admins",
    scope: "both",
    requiredRole: "admin",
    description: "Adiciona um usuário à lista de admins do bot.",
    usage: "add user admins <@>",
    botAdminRequired: false
  },
  {
    category: "admin",
    name: "rm user admins",
    scope: "both",
    requiredRole: "admin",
    description: "Remove um usuário da lista de admins do bot.",
    usage: "rm user admins <@>"
  },
  {
    category: "admin",
    name: "list user admins",
    scope: "both",
    requiredRole: "admin",
    description: "Lista admins do bot.",
    usage: "list user admins"
  },
  {
    category: "admin",
    name: "alias link",
    scope: "both",
    requiredRole: "admin",
    description: "Vincula número e LID a um usuário (root/admin).",
    usage: "alias link <phoneNumber> <lidJid>"
  }
];

export const moderationCommands: CommandDefinition[] = [
  {
    category: "moderation",
    name: "ban",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Bane um usuário do grupo.",
    usage: "ban <@>"
  },
  {
    category: "moderation",
    name: "kick",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Remove um usuário do grupo.",
    usage: "kick <@>"
  },
  {
    category: "moderation",
    name: "mute",
    scope: "both",
    requiredRole: "member",
    botAdminRequired: false,
    description: "Silencia escopo atual ou um membro no grupo.",
    usage: "mute [@user] <duration>|off"
  },
  {
    category: "moderation",
    name: "unmute",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Reativa um usuário no grupo.",
    usage: "unmute <@>"
  },
  {
    category: "moderation",
    name: "hidetag",
    capability: "command.hidetag",
    scope: "group",
    requiredRole: "admin",
    botAdminRequired: true,
    description: "Envia texto ou reenvia mídia respondida com menção oculta a todos.",
    usage: "hidetag <texto>  ou  hidetag (respondendo texto/mídia)",
    examples: ["hidetag aviso importante", "hidetag (respondendo sticker)", "hidetag (respondendo áudio)"]
  }
];

export const taskCommands: CommandDefinition[] = [
  { category: "tasks", name: "task add", scope: "both", description: "Cria uma nova tarefa.", usage: "task add <title>" },
  { category: "tasks", name: "task list", scope: "both", description: "Lista tarefas.", usage: "task list" },
  { category: "tasks", name: "task done", scope: "both", description: "Marca uma tarefa como concluída pelo ID público (ex: TSK001).", usage: "task done <id|publicId>" }
];

export const noteCommands: CommandDefinition[] = [
  { category: "notes", name: "note add", scope: "both", description: "Adiciona uma nota.", usage: "note add <text>" },
  { category: "notes", name: "note list", scope: "both", description: "Lista notas.", usage: "note list" },
  { category: "notes", name: "note rm", scope: "both", description: "Remove uma nota pelo ID público.", usage: "note rm <id>" }
];

export const reminderCommands: CommandDefinition[] = [
  {
    category: "reminders",
    name: "agenda",
    capability: "command.reminder",
    scope: "both",
    description: "Mostra tarefas e lembretes do dia.",
    usage: "agenda"
  },
  {
    category: "reminders",
    name: "timer",
    capability: "command.reminder",
    scope: "both",
    description: "Cria um timer curto.",
    usage: "timer <duration>"
  },
  {
    category: "reminders",
    name: "reminder",
    capability: "command.reminder",
    scope: "both",
    description: "Agenda um lembrete.",
    usage: "reminder in <duration> <message> | reminder at <DD-MM[-YYYY]> [HH:MM] <message>"
  }
];

export const stickerCommands: CommandDefinition[] = [
  {
    category: "tools",
    name: "sticker",
    aliases: ["s", "stk", "fig"],
    scope: "both",
    description: "Converte imagem ou vídeo curto em sticker (envie com legenda ou responda a mídia).",
    usage: "sticker [Autor|Nome_Pacote]",
    examples: ["sticker", "s Zappy-Assistant ;)", "stk Zappy-Assistant ;)|Minha_Pack"]
  },
  {
    category: "tools",
    name: "toimg",
    scope: "both",
    description: "Converte figurinha para imagem (responda um sticker).",
    usage: "toimg"
  },
  {
    category: "tools",
    name: "rnfig",
    scope: "both",
    description: "Renomeia autor e pacote de uma figurinha existente (responda um sticker).",
    usage: "rnfig Autor|Pacote",
    examples: ["rnfig Zappy Team|Pacote Oficial"]
  }
];

export const audioCommands: CommandDefinition[] = [
  {
    category: "tools",
    name: "transcribe",
    aliases: ["tr", "tss"],
    capability: "command.transcribe",
    scope: "both",
    progressAck: true,
    description: "Transcreve audio (responda um audio com /transcribe ou /tss) e mantem fluxo automatico para audio direto.",
    usage: "transcribe (ou tss) respondendo um audio",
    examples: ["transcribe (respondendo um audio)", "tss (respondendo um audio)"]
  }
];

export const ttsCommands: CommandDefinition[] = [
  {
    category: "tools",
    name: "tts",
    capability: "command.tts",
    scope: "both",
    progressAck: true,
    description: "Converte texto em voz (PTT), aceitando texto direto ou texto da mensagem respondida.",
    usage: "tts <texto> |<destino>|<voz>  ou  tts |<destino>|<voz> (respondendo texto)",
    examples: [
      "tts Bom dia a todos",
      "tts Bom dia a todos |en|female",
      "tts Bom dia a todos |pt-BR|en|female",
      "tts (respondendo texto)",
      "tts |en|female (respondendo texto)"
    ]
  }
];

export const translationCommands: CommandDefinition[] = [
  {
    category: "tools",
    name: "trl",
    scope: "both",
    progressAck: true,
    description: "Traduz texto ou áudio respondido com detecção automática e saída curta.",
    usage: "trl <texto> |<destino>  ou  trl |<destino> (respondendo texto/áudio)",
    examples: ["trl Hello", "trl Olá |en", "trl (respondendo texto)", "trl |ar (respondendo áudio)"]
  }
];

export const webSearchCommands: CommandDefinition[] = [
  {
    category: "tools",
    name: "search",
    capability: "command.search",
    scope: "both",
    progressAck: true,
    description: "Busca textual generica na web; aceita termo direto ou mensagem respondida.",
    usage: "search <termo da busca>  ou  search (respondendo texto)",
    examples: ["search arquitetura hexagonal", "search (respondendo texto)"]
  },
  {
    category: "tools",
    name: "google",
    capability: "command.search",
    scope: "both",
    progressAck: true,
    description: "Busca textual usando Google real; aceita termo direto ou mensagem respondida.",
    usage: "google <termo da busca>  ou  google (respondendo texto)",
    examples: ["google status docker compose", "google (respondendo texto)"]
  },
  {
    category: "tools",
    name: "search-ai",
    aliases: ["sai"],
    capability: "command.search_ai",
    scope: "both",
    progressAck: true,
    description: "Busca assistida por IA com internet; aceita termo direto ou mensagem respondida.",
    usage: "search-ai <termo da busca>  ou  search-ai (respondendo texto)",
    examples: ["search-ai ultimas noticias sobre IA no Brasil", "sai (respondendo texto)"]
  }
];

export const imageSearchCommands: CommandDefinition[] = [
  {
    category: "tools",
    name: "img",
    aliases: ["gimage"],
    capability: "command.img",
    scope: "both",
    progressAck: true,
    description: "Busca imagem com legenda curta/relevante e fonte única; aceita termo direto ou mensagem respondida.",
    usage: "img <termo da busca>  ou  img (respondendo texto)",
    examples: ["img meme arabe", "img gatos persas", "gimage infraestrutura de redes", "img (respondendo texto)"]
  },
  {
    category: "tools",
    name: "imglink",
    capability: "command.img",
    scope: "both",
    progressAck: true,
    description: "Busca imagem e retorna link conciso quando necessario; aceita termo direto ou mensagem respondida.",
    usage: "imglink <termo da busca>  ou  imglink (respondendo texto)",
    examples: ["imglink Porsche 911 GT3RS", "imglink macarrao com queijo", "imglink (respondendo texto)"]
  }
];

export const downloadCommands: CommandDefinition[] = [
  {
    category: "tools",
    name: "dl",
    capability: "command.download",
    scope: "both",
    progressAck: true,
    description: "Baixa mídia por link com detecção automática de provider (ou provider explícito).",
    usage: "dl <link>  ou  dl <yt|ig|fb|direct> <link>",
    examples: [
      "dl https://www.instagram.com/reel/...",
      "dl ig https://www.instagram.com/p/...",
      "dl direct https://..."
    ]
  }
];

export const identityCommands: CommandDefinition[] = [
  {
    category: "identity",
    name: "whoami",
    scope: "both",
    description: "Mostra suas permissões e contexto.",
    usage: "whoami"
  },
  {
    category: "identity",
    name: "userinfo",
    scope: "group",
    description: "Mostra informações de um usuário mencionado ou respondido.",
    usage: "userinfo <reply|@mention>"
  }
];

export const allCommands: CommandDefinition[] = [
  ...coreCommands,
  ...groupCommands,
  ...adminCommands,
  ...moderationCommands,
  ...taskCommands,
  ...noteCommands,
  ...stickerCommands,
  ...audioCommands,
  ...ttsCommands,
  ...translationCommands,
  ...webSearchCommands,
  ...imageSearchCommands,
  ...downloadCommands,
  ...reminderCommands,
  ...identityCommands
];
