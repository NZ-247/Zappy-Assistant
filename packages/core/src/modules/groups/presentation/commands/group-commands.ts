import type { GroupAccessPort, GroupAccessState, GroupAdminOperation, PipelineContext, ResponseAction } from "../../../../index.js";

type GroupCommandKey =
  | "groupinfo"
  | "rules"
  | "fix"
  | "set gp"
  | "add gp allowed_groups"
  | "rm gp allowed_groups"
  | "list gp allowed_groups"
  | "chat";

export interface GroupCommandDeps {
  groupAccess?: GroupAccessPort;
  botAdminLabel: string;
  requireGroup: () => ResponseAction[] | null;
  requireAdmin: () => ResponseAction[] | null;
  enforceBotAdmin: (command: string) => ResponseAction[] | null;
  botAdminWarning: (command: string) => string | null;
  stylizeReply: (text: string) => string;
  formatCmd: (body: string) => string;
  now: Date;
  formatGroupAccessBotAdmin: (state: GroupAccessState, now: Date) => string;
}

export const handleGroupCommand = async (input: {
  commandKey: string;
  lower: string;
  cmd: string;
  ctx: PipelineContext;
  deps: GroupCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, lower, cmd, ctx, deps } = input;
  const {
    groupAccess,
    botAdminLabel,
    requireGroup,
    requireAdmin,
    enforceBotAdmin,
    botAdminWarning,
    stylizeReply,
    formatCmd,
    now,
    formatGroupAccessBotAdmin
  } = deps;

  if (commandKey === "groupinfo") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const access = ctx.groupAccess;
    const lines = [
      `Grupo: ${ctx.event.waGroupId}`,
      `Nome: ${access?.groupName ?? ctx.identity?.groupName ?? ctx.event.waGroupId ?? "-"}`,
      `Permitido: ${access?.allowed ? "sim" : "não"}`,
      `Modo de chat: ${access?.chatMode ?? ctx.groupChatMode}`,
      `Bot admin: ${botAdminLabel}`
    ];
    return [{ kind: "reply_text", text: lines.join("\n") }];
  }

  if (commandKey === "rules") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const rules = ctx.groupRulesText ?? ctx.groupAccess?.rulesText;
    if (!rules) return [{ kind: "reply_text", text: stylizeReply("Regras não configuradas.") }];
    return [{ kind: "reply_text", text: stylizeReply(rules) }];
  }

  if (commandKey === "fix") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const fixed = ctx.groupFixedMessageText ?? ctx.groupAccess?.fixedMessageText;
    if (!fixed) return [{ kind: "reply_text", text: stylizeReply("Mensagem fixa não configurada.") }];
    return [{ kind: "reply_text", text: stylizeReply(fixed) }];
  }

  if (commandKey === "set gp") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    const botAdminGuard = enforceBotAdmin(lower);
    if (botAdminGuard) return botAdminGuard;
    if (!groupAccess) return [{ kind: "reply_text", text: stylizeReply("Controle de grupo não está configurado.") }];

    const args = cmd.replace(/^set gp\s+/i, "");
    const [sub, ...restTokens] = args.split(/\s+/);
    const restText = args.replace(/^\S+\s*/, "").trim();
    const normalizedSub = (sub ?? "").toLowerCase();

    if (normalizedSub === "chat") {
      const mode = restTokens[0] === "off" ? "off" : restTokens[0] === "on" ? "on" : null;
      if (!mode) return [{ kind: "reply_text", text: stylizeReply(`Use: ${formatCmd("set gp chat on|off")}`) }];
      const updated = await groupAccess.setChatMode({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId!,
        mode,
        actor: ctx.event.waUserId
      });
      const warning = botAdminWarning(lower);
      return [
        {
          kind: "reply_text",
          text: stylizeReply(
            `Modo de chat ajustado para ${updated.chatMode}. Permitido=${updated.allowed ? "sim" : "não"}. Bot admin=${botAdminLabel}.${warning ? ` ${warning}` : ""}`
          )
        }
      ];
    }

    if (normalizedSub === "open" || normalizedSub === "close") {
      const operation: GroupAdminOperation = normalizedSub === "open" ? "set_open" : "set_closed";
      return [
        {
          kind: "group_admin_action",
          operation,
          waGroupId: ctx.event.waGroupId!,
          actorWaUserId: ctx.event.waUserId
        }
      ];
    }

    if (normalizedSub === "name") {
      if (!restText) return [{ kind: "reply_text", text: stylizeReply("Informe o novo nome do grupo.") }];
      return [
        {
          kind: "group_admin_action",
          operation: "set_subject",
          waGroupId: ctx.event.waGroupId!,
          actorWaUserId: ctx.event.waUserId,
          text: restText
        }
      ];
    }

    if (normalizedSub === "dcr") {
      if (!restText) return [{ kind: "reply_text", text: stylizeReply("Informe a nova descrição.") }];
      return [
        {
          kind: "group_admin_action",
          operation: "set_description",
          waGroupId: ctx.event.waGroupId!,
          actorWaUserId: ctx.event.waUserId,
          text: restText
        }
      ];
    }

    if (normalizedSub === "img") {
      return [
        {
          kind: "group_admin_action",
          operation: "set_picture_from_quote",
          waGroupId: ctx.event.waGroupId!,
          actorWaUserId: ctx.event.waUserId,
          quotedWaMessageId: ctx.event.quotedWaMessageId
        }
      ];
    }

    if (normalizedSub === "fix") {
      if (!restText) return [{ kind: "reply_text", text: stylizeReply("Envie o texto fixo após o comando.") }];
      const updated = await groupAccess.updateSettings({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId!,
        actor: ctx.event.waUserId,
        settings: { fixedMessageText: restText }
      });
      return [{ kind: "reply_text", text: stylizeReply(`Mensagem fixa atualizada.${updated.fixedMessageText ? "" : " (vazia)"}`) }];
    }

    if (normalizedSub === "rules") {
      if (!restText) return [{ kind: "reply_text", text: stylizeReply("Envie o texto das regras após o comando.") }];
      await groupAccess.updateSettings({
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId!,
        actor: ctx.event.waUserId,
        settings: { rulesText: restText }
      });
      return [{ kind: "reply_text", text: stylizeReply("Regras atualizadas.") }];
    }

    if (normalizedSub === "welcome") {
      const mode = restTokens[0]?.toLowerCase();
      if (mode === "on" || mode === "off") {
        const updated = await groupAccess.updateSettings({
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId!,
          actor: ctx.event.waUserId,
          settings: { welcomeEnabled: mode === "on" }
        });
        return [{ kind: "reply_text", text: stylizeReply(`Mensagem de boas-vindas ${updated.welcomeEnabled ? "ativada" : "desativada"}.`) }];
      }
      if (mode === "text") {
        const text = restTokens.slice(1).join(" ").trim();
        if (!text) return [{ kind: "reply_text", text: stylizeReply("Informe o texto após 'welcome text'.") }];
        await groupAccess.updateSettings({
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId!,
          actor: ctx.event.waUserId,
          settings: { welcomeText: text }
        });
        return [{ kind: "reply_text", text: stylizeReply("Texto de boas-vindas atualizado.") }];
      }
      return [{ kind: "reply_text", text: stylizeReply(`Use: ${formatCmd("set gp welcome on|off")} ou ${formatCmd("set gp welcome text <mensagem>")}.`) }];
    }

    return [{ kind: "reply_text", text: stylizeReply("Comando set gp não reconhecido.") }];
  }

  if (commandKey === "add gp allowed_groups") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    const botAdminGuard = enforceBotAdmin(lower);
    if (botAdminGuard) return botAdminGuard;
    if (!groupAccess) return [{ kind: "reply_text", text: "Controle de grupos não está configurado." }];
    const updated = await groupAccess.setAllowed({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId!,
      allowed: true,
      actor: ctx.event.waUserId
    });
    const warning = botAdminWarning(lower);
    return [
      {
        kind: "reply_text",
        text: stylizeReply(
          `Grupo autorizado: ${updated.groupName ?? updated.waGroupId}. Chat=${updated.chatMode}. Bot admin=${botAdminLabel}.${warning ? ` ${warning}` : ""}`
        )
      }
    ];
  }

  if (commandKey === "rm gp allowed_groups") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    const botAdminGuard = enforceBotAdmin(lower);
    if (botAdminGuard) return botAdminGuard;
    if (!groupAccess) return [{ kind: "reply_text", text: "Controle de grupos não está configurado." }];
    const updated = await groupAccess.setAllowed({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId!,
      allowed: false,
      actor: ctx.event.waUserId
    });
    const warning = botAdminWarning(lower);
    return [
      {
        kind: "reply_text",
        text: stylizeReply(
          `Grupo removido da lista permitida: ${updated.groupName ?? updated.waGroupId}. Chat=${updated.chatMode}.${warning ? ` ${warning}` : ""}`
        )
      }
    ];
  }

  if (commandKey === "list gp allowed_groups") {
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    if (!groupAccess) return [{ kind: "reply_text", text: "Controle de grupos não está configurado." }];
    const groups = await groupAccess.listAllowed(ctx.event.tenantId);
    if (groups.length === 0) return [{ kind: "reply_text", text: "Nenhum grupo autorizado." }];
    return [
      {
        kind: "reply_list",
        header: "Grupos autorizados",
        items: groups.map((g) => ({
          title: g.groupName ?? g.waGroupId,
          description: `chat=${g.chatMode} botAdmin=${formatGroupAccessBotAdmin(g, now)}`
        }))
      }
    ];
  }

  if (commandKey === "chat") {
    const groupCheck = requireGroup();
    if (groupCheck) return groupCheck;
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    const botAdminGuard = enforceBotAdmin(lower);
    if (botAdminGuard) return botAdminGuard;
    if (!groupAccess) return [{ kind: "reply_text", text: "Controle de grupos não está configurado." }];

    const modeToken = lower.split(/\s+/)[1];
    const mode = modeToken === "off" ? "off" : modeToken === "on" ? "on" : null;
    if (!mode) return [{ kind: "reply_text", text: stylizeReply(`Use: ${formatCmd("chat on|off")}`) }];

    const updated = await groupAccess.setChatMode({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId!,
      mode,
      actor: ctx.event.waUserId
    });
    const warning = botAdminWarning(lower);
    return [
      {
        kind: "reply_text",
        text: stylizeReply(
          `Modo de chat do grupo ajustado para ${updated.chatMode}. Permitido=${updated.allowed ? "sim" : "não"}. Bot admin=${botAdminLabel}.${
            warning ? ` ${warning}` : ""
          }`
        )
      }
    ];
  }

  return null;
};
