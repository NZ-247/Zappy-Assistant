import type { PipelineContext } from "../../../pipeline/context.js";
import type { ResponseAction } from "../../../pipeline/actions.js";

const INTERNAL_ROLE_LABELS = "(?:root|creator_root|bot_admin|group_admin|admin|owner|dono|privileged)";

const stripInternalRoleAsName = (text: string, preferredName: string): string => {
  const name = preferredName.trim() || "você";
  let next = text;
  next = next.replace(new RegExp(`^${INTERNAL_ROLE_LABELS}\\b[:,\\s-]*`, "i"), `${name}, `);
  next = next.replace(new RegExp(`\\b(ol[áa]|oi|hello|hey)\\s*,?\\s*${INTERNAL_ROLE_LABELS}\\b[:,\\s-]*`, "gi"), `$1 ${name}`);
  next = next.replace(new RegExp(`\\b(voc[eê]|tu)\\s*,?\\s*${INTERNAL_ROLE_LABELS}\\b[:,\\s-]*`, "gi"), "$1 ");
  return next.replace(/\s{2,}/g, " ").trim();
};

export class AiRoutingService {
  constructor(private readonly deps: { hasRootPrivilege: (ctx: PipelineContext) => boolean }) {}

  sanitizeAiText(ctx: PipelineContext, text: string): string {
    if (!text) return text;
    const normalizedQuestion = ctx.event.normalizedText.toLowerCase();
    const isCreator = ctx.relationshipProfile === "creator_root";
    const isMother = ctx.relationshipProfile === "mother_privileged";
    const isRoot = this.deps.hasRootPrivilege(ctx);
    const nameDenials = [/i (?:do )?not have (?:a )?(?:proper )?name/i, /não tenho (?:um )?nome/i, /sem nome/i];
    const downgradeRole = [
      /(standard|regular)\s+(user|member)/i,
      /membro\s+(padr[aã]o|comum)/i,
      /usu[aá]rio\s+(padr[aã]o|comum)/i
    ];
    if (nameDenials.some((p) => p.test(text))) {
      text = "Meu nome é Zappy, o assistente digital deste sistema.";
    }
    if (isRoot && downgradeRole.some((p) => p.test(text))) {
      text = "Você tem controle administrativo total neste sistema. Sou Zappy, pronto para executar suas instruções.";
    }
    if (isRoot && /criad[oa]\s+por\s+(uma\s+)?(equipe|time)\s+de\s+ia/i.test(text)) {
      text = "Fui criada para este sistema por você (NZ_DEV) e atuo como sua assistente Zappy.";
    }
    if (isRoot && /created by an ai team/i.test(text)) {
      text = "I was created here for you (NZ_DEV) and serve you as Zappy with full administrative alignment.";
    }

    const askedName =
      /como se chama|qual (?:é|é)? seu nome|qual o seu nome|seu nome\??|what is your name|who are you\b/i.test(normalizedQuestion);
    if (askedName) {
      text = "Sou Zappy, seu assistente digital.";
    }

    const askedWhoAmI = /quem sou eu(?: (?:para|pra) voc[eê])?|who am i to you/i.test(normalizedQuestion);
    if (askedWhoAmI) {
      if (isCreator) {
        text = "Você é meu criador (NZ_DEV) e tem controle administrativo total. Estou aqui para ajudar proativamente.";
      } else if (isMother) {
        text = "Você é minha mãe e contato privilegiado; respondo com carinho, respeito e prontidão para ajudar.";
      }
    }

    const askedPermissions =
      /(quais|minhas).{0,20}permiss(?:ões|oes)|what are my permissions|quais s[aã]o minhas permiss/i.test(normalizedQuestion);
    if (askedPermissions && isRoot) {
      text = "Você possui controle administrativo completo sobre o sistema.";
    }

    if (!/zappy/i.test(text) && nameDenials.some((p) => p.test(text))) {
      text = `Sou Zappy, seu assistente digital. ${text}`;
    }

    return stripInternalRoleAsName(text.trim(), ctx.addressingName);
  }

  guardAiResponses(ctx: PipelineContext, actions: ResponseAction[]): ResponseAction[] {
    return actions.map((action) => {
      if (action.kind === "reply_text") {
        return { ...action, text: this.sanitizeAiText(ctx, action.text) };
      }
      if (action.kind === "ai_tool_suggestion" && action.text) {
        return { ...action, text: this.sanitizeAiText(ctx, action.text) };
      }
      return action;
    });
  }
}
