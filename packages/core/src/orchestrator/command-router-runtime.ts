import { requireGroupContext } from "../common/bot-common.js";
import { formatCommand } from "../commands/parser/prefix.js";
import { buildCommandHelpLines, buildProfileNotice } from "../commands/help-renderer.js";
import type { HelpVisibilityContext } from "../commands/help-renderer.js";
import type { PipelineContext } from "../pipeline/context.js";
import type { ResponseAction } from "../pipeline/actions.js";
import type { GroupAccessState } from "../pipeline/types.js";
import type { CommandRouterDeps, ParsedCommand, RouterRuntime } from "./command-router.js";

const formatRequesterLabel = (ctx: PipelineContext): string => {
  const role = (ctx.identity?.permissionRole ?? ctx.identity?.role ?? "member").toUpperCase();
  const profile = ctx.relationshipProfile ?? ctx.identity?.relationshipProfile ?? "member";
  return profile && profile !== "member" ? `${role} (${profile})` : role;
};

const formatGroupAccessBotAdmin = (group: GroupAccessState, now: Date, staleMs: number): string => {
  const checkedAt = group.botAdminCheckedAt ?? undefined;
  const isFresh = checkedAt ? now.getTime() - checkedAt.getTime() < staleMs : false;
  if (typeof group.botIsAdmin === "boolean" && isFresh) return group.botIsAdmin ? "verified yes" : "verified no";
  if (typeof group.botIsAdmin === "boolean") return group.botIsAdmin ? "yes (stale)" : "no (stale)";
  return "unknown";
};

const formatBotAdminStatus = (
  ctx: PipelineContext,
  options: { botAdminStaleMs: number; botAdminOperationStaleMs: number }
): { label: string; detail?: string } => {
  if (!ctx.event.isGroup) return { label: "n/a" };

  const source = ctx.botAdminStatusSource ?? ctx.botAdminSourceUsed ?? "unknown";
  const checkedAt = ctx.botAdminCheckedAt ?? ctx.groupAccess?.botAdminCheckedAt ?? undefined;
  const usedOptimisticDefault = (ctx.botAdminSourceUsed ?? "").startsWith("default");
  const window = source === "operation" ? options.botAdminOperationStaleMs : options.botAdminStaleMs;
  const isFresh = checkedAt ? ctx.now.getTime() - checkedAt.getTime() < window : false;

  if (!ctx.botAdminCheckFailed && !usedOptimisticDefault && typeof ctx.botIsGroupAdmin === "boolean" && isFresh) {
    return { label: ctx.botIsGroupAdmin ? "verified yes" : source === "operation" ? "verified no" : "likely no", detail: source };
  }

  if (ctx.botAdminCheckFailed) {
    return { label: "unknown (metadata unavailable)", detail: ctx.botAdminCheckError ?? source };
  }

  return { label: "unknown / not recently verified", detail: isFresh ? source : undefined };
};

const buildHelpResponse = (ctx: PipelineContext, deps: CommandRouterDeps): string => {
  const isRoot = deps.hasRootPrivilege(ctx);
  const visibility: HelpVisibilityContext = {
    isGroup: ctx.event.isGroup,
    isAdmin: deps.isRequesterAdmin(ctx),
    isRoot,
    isGroupAdmin: ctx.requesterIsGroupAdmin ?? false,
    relationshipProfile: ctx.relationshipProfile ?? ctx.identity?.relationshipProfile ?? null,
    botIsGroupAdmin: ctx.botIsGroupAdmin
  };
  const commands = buildCommandHelpLines({
    registry: deps.commandRegistry,
    prefix: deps.commandPrefix,
    visibility
  });
  const withPrefix = (body: string) => formatCommand(deps.commandPrefix, body);
  const requester = formatRequesterLabel(ctx);
  const botAdminStatus = formatBotAdminStatus(ctx, deps);
  const botAdminLabel = botAdminStatus.detail ? `${botAdminStatus.label} (${botAdminStatus.detail})` : botAdminStatus.label;
  const prefixLine = `Prefixo: ${deps.commandPrefix}`;

  if (!ctx.event.isGroup) {
    const profileNotice = buildProfileNotice(visibility.relationshipProfile, isRoot);
    const lines = [prefixLine, `Você: ${requester}`, "Comandos:", ...commands];
    if (profileNotice) lines.unshift(profileNotice);
    return lines.join("\n");
  }

  const groupLabel = ctx.identity?.groupName ?? ctx.groupAccess?.groupName ?? ctx.event.waGroupId ?? "grupo";
  const aiActive = ctx.assistantMode !== "off" && ctx.groupChatMode === "on";
  const aiLabel = aiActive ? "ativo (menções/respostas)" : "restrito";
  const lines = [
    `Grupo: ${groupLabel}`,
    `ID: ${ctx.event.waGroupId ?? "-"}`,
    `Permitido: ${ctx.groupAllowed ? "sim" : "não"}`,
    `Bot admin: ${botAdminLabel}`,
    `Abertura: ${ctx.groupIsOpen ? "aberto" : "fechado"}`,
    `Welcome: ${ctx.groupWelcomeEnabled ? "on" : "off"}`,
    `Chat: ${ctx.groupChatMode.toUpperCase()}`,
    `AI: ${aiLabel}`,
    prefixLine,
    `Você: ${requester}`
  ];
  const missing: string[] = [];
  if (!ctx.groupAllowed) missing.push(`Grupo não autorizado (use ${withPrefix("add gp allowed_groups")}).`);
  if (ctx.groupChatMode === "off") missing.push(`Chat do bot está OFF (use ${withPrefix("chat on")}).`);
  if (ctx.assistantMode === "off") missing.push("AI desativada (assistant_mode=off).");
  if (missing.length > 0) {
    lines.push("Pendências:");
    lines.push(...missing.map((item) => `- ${item}`));
  }
  lines.push("Comandos:");
  lines.push(...commands);
  return lines.join("\n");
};

export const createRouterRuntime = (ctx: PipelineContext, deps: CommandRouterDeps, parsed: ParsedCommand, commandStartedAt: Date): RouterRuntime => {
  const { raw: rawCmd, body: cmd, lower, match } = parsed;
  const commandKey = match?.command.name ?? parsed.token;
  const formatCmd = (body: string) => formatCommand(deps.commandPrefix, body);

  const usageFor = (name: string): string | null => {
    const def = deps.commandRegistry.find(name);
    if (!def) return null;
    return deps.stylizeReply(ctx, `Uso correto: ${formatCmd(def.usage)}`);
  };

  const usageForToken = (token: string): string | null => {
    if (!token) return null;
    const candidates = deps.commandRegistry
      .list()
      .filter((item) => {
        const first = item.name.split(/\s+/)[0] ?? item.name;
        const aliasFirsts = item.aliases?.map((alias) => alias.split(/\s+/)[0] ?? alias) ?? [];
        return first === token || aliasFirsts.includes(token);
      });
    if (candidates.length === 0) return null;
    const lines = candidates.slice(0, 4).map((item) => `- ${formatCmd(item.usage)} — ${item.description}`);
    return deps.stylizeReply(ctx, `Comando incompleto. Exemplos:\n${lines.join("\n")}`);
  };

  const botAdminStatus = formatBotAdminStatus(ctx, deps);
  const botAdminLabel = botAdminStatus.detail ? `${botAdminStatus.label} (${botAdminStatus.detail})` : botAdminStatus.label;

  const requireAdmin = (): ResponseAction[] | null => {
    if (deps.isRequesterAdmin(ctx)) return null;
    if (process.env.NODE_ENV !== "production" && lower.startsWith("chat")) {
      deps.ports.logger?.debug?.(
        {
          category: "BOT_ADMIN_GUARD",
          tenantId: ctx.event.tenantId,
          waGroupId: ctx.event.waGroupId,
          command: rawCmd,
          guard: "require_bot_admin_user",
          decision: "deny",
          botIsAdmin: ctx.botIsGroupAdmin,
          sourceUsed: ctx.botAdminSourceUsed,
          statusSource: ctx.botAdminStatusSource,
          requesterIsAdmin: false
        },
        "bot admin user guard blocked command"
      );
    }
    return [{ kind: "reply_text", text: deps.stylizeReply(ctx, "Somente admins do bot podem usar este comando.") }];
  };

  const requireGroup = (): ResponseAction[] | null => {
    const check = requireGroupContext(ctx.event);
    if (check.ok) return null;
    return [{ kind: "reply_text", text: deps.stylizeReply(ctx, check.message ?? "Disponível apenas em grupos.") }];
  };

  const enforceBotAdminForOperation = (command: string): ResponseAction[] | null => {
    if (!ctx.event.isGroup) return null;
    if (!deps.commandRequiresGroupAdmin(command)) return null;
    if (ctx.botAdminStatusSource === "operation") {
      if (ctx.botIsGroupAdmin === true) return null;
      if (ctx.botIsGroupAdmin === false) {
        return [
          {
            kind: "reply_text",
            text: deps.stylizeReply(ctx, "Preciso ser admin do grupo para executar este comando. Promova o bot e tente novamente.")
          }
        ];
      }
      return [{ kind: "reply_text", text: deps.stylizeReply(ctx, "Não consegui confirmar se sou admin agora. Tente novamente em instantes.") }];
    }
    return null;
  };

  const botAdminWarning = (command: string): string | null => {
    if (!ctx.event.isGroup) return null;
    if (!deps.commandRequiresGroupAdmin(command)) return null;
    if (ctx.botAdminStatusSource === "operation") return null;
    if (ctx.botAdminCheckFailed) return "Aviso: status de admin não foi verificado agora; confirme se o bot é admin.";
    if (typeof ctx.botIsGroupAdmin === "boolean" && ctx.botIsGroupAdmin === false) {
      return "Aviso: metadata sugere que o bot não é admin; se falhar, torne o bot admin e repita.";
    }
    return null;
  };

  const formatIdentity = async (waUserId: string, waGroupId?: string): Promise<string> => {
    if (!deps.ports.identity) {
      return `Usuário: ${waUserId}`;
    }
    const identity = await deps.ports.identity.getIdentity({
      tenantId: ctx.event.tenantId,
      waUserId,
      waGroupId
    });
    const resolvedProfile = identity?.relationshipProfile ?? null;
    const permRole = (identity?.permissionRole ?? identity?.role ?? "member").toUpperCase();
    const isAdminListed = deps.ports.adminAccess
      ? await deps.ports.adminAccess.isAdmin({ tenantId: ctx.event.tenantId, waUserId })
      : permRole === "ADMIN";
    const lines = [
      `Usuário: ${identity?.displayName ?? waUserId}`,
      `waUserId: ${waUserId}`,
      `Permissão: ${permRole}${isAdminListed ? " (bot admin)" : ""}`,
      `Permissões efetivas: ${identity?.permissions.join(", ") || "nenhuma"}`
    ];
    const canonical = identity?.canonicalIdentity;
    if (canonical?.phoneNumber) lines.push(`Telefone: ${canonical.phoneNumber}`);
    if (canonical?.lidJid) lines.push(`LID: ${canonical.lidJid}`);
    if (canonical?.pnJid) lines.push(`PN: ${canonical.pnJid}`);
    if (resolvedProfile) lines.push(`Perfil: ${resolvedProfile}`);
    if (identity?.groupName) lines.push(`Grupo: ${identity.groupName}`);
    return lines.join("\n");
  };

  return {
    ctx,
    deps,
    parsed,
    commandStartedAt,
    rawCmd,
    cmd,
    lower,
    match,
    commandKey,
    formatCmd,
    usageFor,
    usageForToken,
    botAdminLabel,
    requireAdmin,
    requireGroup,
    enforceBotAdminForOperation,
    botAdminWarning,
    formatIdentity,
    buildHelpResponse: () => buildHelpResponse(ctx, deps),
    formatGroupAccessBotAdmin: (group, nowDate) => formatGroupAccessBotAdmin(group, nowDate, deps.botAdminStaleMs)
  };
};
