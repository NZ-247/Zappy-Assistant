import { addDurationToNow, formatDateTimeInZone, getDayRange, parseDurationInput } from "../time.js";
import { resolveTargetUserFromMentionOrReply, requireGroupContext } from "../common/bot-common.js";
import { formatCommand } from "../commands/parser/prefix.js";
import { buildCommandHelpLines, buildProfileNotice } from "../commands/help-renderer.js";
import type { HelpVisibilityContext } from "../commands/help-renderer.js";
import type { CommandRegistry } from "../commands/registry/command-types.js";
import { parseCommandText } from "../commands/parser/parse-command.js";
import { handleGroupCommand } from "../modules/groups/presentation/commands/group-commands.js";
import { handleModerationCommand } from "../modules/moderation/presentation/commands/moderation-commands.js";
import { handleReminderCommand } from "../modules/reminders/presentation/commands/reminder-commands.js";
import { handleTaskCommand } from "../modules/tasks/presentation/commands/task-commands.js";
import { handleNoteCommand } from "../modules/notes/presentation/commands/note-commands.js";
import { evaluateExpression } from "../common/math-expression.js";
import { formatAgenda } from "../modules/reminders/infrastructure/agenda-formatter.js";
import type { CorePorts } from "../pipeline/ports.js";
import type { PipelineContext } from "../pipeline/context.js";
import type { ResponseAction } from "../pipeline/actions.js";
import type { GroupAccessState } from "../pipeline/types.js";

export interface CommandRouterDeps {
  ports: CorePorts;
  commandPrefix: string;
  commandRegistry: CommandRegistry;
  botAdminStaleMs: number;
  botAdminOperationStaleMs: number;
  hasRootPrivilege: (ctx: PipelineContext) => boolean;
  isRequesterAdmin: (ctx: PipelineContext) => boolean;
  commandRequiresGroupAdmin: (commandName?: string) => boolean;
  stylizeReply: (ctx: PipelineContext, text: string, options?: { suggestNext?: string }) => string;
}

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

type ParsedCommand = NonNullable<ReturnType<typeof parseCommandText>>;

interface RouterRuntime {
  ctx: PipelineContext;
  deps: CommandRouterDeps;
  parsed: ParsedCommand;
  commandStartedAt: Date;
  rawCmd: string;
  cmd: string;
  lower: string;
  match: ParsedCommand["match"];
  commandKey: string;
  formatCmd: (body: string) => string;
  usageFor: (name: string) => string | null;
  usageForToken: (token: string) => string | null;
  botAdminLabel: string;
  requireAdmin: () => ResponseAction[] | null;
  requireGroup: () => ResponseAction[] | null;
  enforceBotAdminForOperation: (command: string) => ResponseAction[] | null;
  botAdminWarning: (command: string) => string | null;
  formatIdentity: (waUserId: string, waGroupId?: string) => Promise<string>;
}

const createRouterRuntime = (ctx: PipelineContext, deps: CommandRouterDeps, parsed: ParsedCommand, commandStartedAt: Date): RouterRuntime => {
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
    formatIdentity
  };
};

const handleGroupAndAdminCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
  const { ctx, deps, commandKey, lower, cmd, commandStartedAt, botAdminLabel, requireGroup, requireAdmin, enforceBotAdminForOperation, botAdminWarning, formatCmd } =
    runtime;

  const groupHandled = await handleGroupCommand({
    commandKey,
    lower,
    cmd,
    ctx,
    deps: {
      groupAccess: deps.ports.groupAccess,
      botAdminLabel,
      requireGroup,
      requireAdmin,
      enforceBotAdmin: enforceBotAdminForOperation,
      botAdminWarning,
      stylizeReply: (text) => deps.stylizeReply(ctx, text),
      formatCmd,
      now: ctx.now,
      formatGroupAccessBotAdmin: (state, nowDate) => formatGroupAccessBotAdmin(state, nowDate, deps.botAdminStaleMs)
    }
  });
  if (groupHandled) return groupHandled;

  if (commandKey === "help") {
    return [{ kind: "reply_text", text: buildHelpResponse(ctx, deps) }];
  }

  if (commandKey === "ping") {
    const elapsedMs = (deps.ports.clock?.now?.() ?? new Date()).getTime() - commandStartedAt.getTime();
    return [{ kind: "reply_text", text: `Pong! 🏓\nms: ${elapsedMs}` }];
  }

  if (commandKey === "add user admins") {
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    if (!deps.ports.adminAccess) return [{ kind: "reply_text", text: "Lista de admins não está configurada." }];
    const target = resolveTargetUserFromMentionOrReply(ctx.event);
    if (!target) return [{ kind: "reply_text", text: "Mencione ou responda a quem deseja promover a admin." }];
    const added = await deps.ports.adminAccess.add({
      tenantId: ctx.event.tenantId,
      waUserId: target,
      displayName: ctx.event.waUserId === target ? ctx.identity?.displayName : undefined,
      actor: ctx.event.waUserId
    });
    return [
      {
        kind: "reply_text",
        text: deps.stylizeReply(
          ctx,
          `Admin adicionado: ${added.displayName ?? added.waUserId} (${added.waUserId}). Permissão=${added.permissionRole ?? "ADMIN"}.`
        )
      }
    ];
  }

  if (commandKey === "rm user admins") {
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    if (!deps.ports.adminAccess) return [{ kind: "reply_text", text: "Lista de admins não está configurada." }];
    const target = resolveTargetUserFromMentionOrReply(ctx.event);
    if (!target) return [{ kind: "reply_text", text: "Mencione ou responda a quem deseja remover da lista de admins." }];
    const removed = await deps.ports.adminAccess.remove({
      tenantId: ctx.event.tenantId,
      waUserId: target,
      actor: ctx.event.waUserId
    });
    return [
      {
        kind: "reply_text",
        text: deps.stylizeReply(ctx, removed ? `Admin removido: ${target}.` : `Usuário ${target} não estava na lista de admins.`)
      }
    ];
  }

  if (commandKey === "list user admins") {
    const adminCheck = requireAdmin();
    if (adminCheck) return adminCheck;
    if (!deps.ports.adminAccess) return [{ kind: "reply_text", text: "Lista de admins não está configurada." }];
    const admins = await deps.ports.adminAccess.list(ctx.event.tenantId);
    if (admins.length === 0) return [{ kind: "reply_text", text: "Nenhum admin cadastrado." }];
    return [
      {
        kind: "reply_list",
        header: "Admins do bot",
        items: admins.map((admin) => ({
          title: admin.displayName ?? admin.waUserId,
          description: `${admin.waUserId}${admin.permissionRole ? ` · ${admin.permissionRole}` : ""}`
        }))
      }
    ];
  }

  return null;
};

const handleModuleCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
  const { commandKey, lower, cmd, ctx, deps, requireGroup, requireAdmin, enforceBotAdminForOperation, formatCmd, usageFor } = runtime;

  const moderationHandled = handleModerationCommand({
    commandKey,
    lower,
    cmd,
    ctx,
    deps: {
      requireGroup,
      requireAdmin,
      enforceBotAdmin: enforceBotAdminForOperation,
      stylizeReply: (text) => deps.stylizeReply(ctx, text),
      formatCmd
    }
  });
  if (moderationHandled) return moderationHandled;

  const taskHandled = await handleTaskCommand({
    commandKey,
    cmd,
    ctx,
    deps: { tasksRepository: deps.ports.tasksRepository, formatUsage: (name) => usageFor(name) }
  });
  if (taskHandled) return taskHandled;

  const noteHandled = await handleNoteCommand({
    commandKey,
    cmd,
    ctx,
    deps: { notesRepository: deps.ports.notesRepository, formatUsage: (name) => usageFor(name) }
  });
  if (noteHandled) return noteHandled;

  return null;
};

const handleUtilityCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps } = runtime;

  if (commandKey === "agenda") {
    const range = getDayRange({ date: ctx.now, timezone: ctx.timezone });
    const tasks = await deps.ports.tasksRepository.listTasksForDay({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId,
      dayStart: range.start,
      dayEnd: range.end
    });
    const reminders = await deps.ports.remindersRepository.listForDay({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId,
      dayStart: range.start,
      dayEnd: range.end
    });
    return [{ kind: "reply_text", text: formatAgenda({ dateLabel: range.label, timezone: ctx.timezone, tasks, reminders }) }];
  }

  if (commandKey === "calc") {
    const expression = cmd.replace(/^(calc)\s+/i, "").trim();
    if (!expression) return [{ kind: "reply_text", text: "Forneça uma expressão (ex: 5+10*3)." }];
    try {
      const result = evaluateExpression(expression);
      return [{ kind: "reply_text", text: `${expression} = ${result}` }];
    } catch (error) {
      return [{ kind: "reply_text", text: `Expressão inválida: ${(error as Error).message}` }];
    }
  }

  if (commandKey === "timer") {
    if (!deps.ports.timersRepository) return [{ kind: "reply_text", text: "Módulo de timer não está disponível." }];
    const durationToken = cmd.replace(/^(timer)\s+/i, "").trim();
    const duration = parseDurationInput(durationToken);
    if (!duration) return [{ kind: "reply_text", text: "Formato de duração inválido. Use algo como 10m ou 1h." }];
    const { date, pretty } = addDurationToNow({ durationMs: duration.milliseconds, timezone: ctx.timezone, now: ctx.now });
    const timer = await deps.ports.timersRepository.createTimer({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId,
      fireAt: date,
      durationMs: duration.milliseconds,
      label: duration.pretty
    });
    return [
      { kind: "reply_text", text: `Timer ${timer.id} definido para ${pretty} (${ctx.timezone}).` },
      { kind: "enqueue_job", jobType: "timer", payload: { id: timer.id, runAt: date } }
    ];
  }

  if (commandKey === "mute") {
    if (!deps.ports.mute) return [{ kind: "reply_text", text: "Controle de silêncio não está disponível." }];
    const arg = cmd.replace(/^mute\s*/i, "").trim();
    if (arg.toLowerCase() === "off") {
      await deps.ports.mute.unmute({ tenantId: ctx.event.tenantId, scope: ctx.scope.scope, scopeId: ctx.scope.scopeId });
      return [{ kind: "reply_text", text: "Silêncio desativado." }];
    }
    const duration = parseDurationInput(arg);
    if (!duration) return [{ kind: "reply_text", text: "Informe a duração (ex: 30m, 2h)." }];
    const muted = await deps.ports.mute.mute({
      tenantId: ctx.event.tenantId,
      scope: ctx.scope.scope,
      scopeId: ctx.scope.scopeId,
      durationMs: duration.milliseconds,
      now: ctx.now
    });
    const untilPretty = formatDateTimeInZone(muted.until, ctx.timezone);
    return [{ kind: "reply_text", text: `🤫 Silenciado até ${untilPretty}.` }];
  }

  return null;
};

const handleIdentityAndStatusCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps, formatCmd, formatIdentity, botAdminLabel } = runtime;

  if (commandKey === "alias link") {
    if (!deps.ports.identity?.linkAlias) return [{ kind: "reply_text", text: "Vinculação de alias não está disponível." }];
    const aliasMatch = cmd.match(/^alias\s+link\s+(\S+)\s+(\S+)/i);
    if (!aliasMatch) return [{ kind: "reply_text", text: `Uso correto: ${formatCmd("alias link <phoneNumber> <lidJid>")}` }];

    const [, phoneNumber, lidJid] = aliasMatch;
    const role = (ctx.identity?.permissionRole ?? ctx.identity?.role ?? "").toUpperCase?.() ?? "";
    const allowedRoles = ["ROOT", "ADMIN", "DONO", "OWNER", "PRIVILEGED"];
    const allowedProfile = ctx.relationshipProfile === "creator_root" || ctx.relationshipProfile === "mother_privileged";
    if (!allowedRoles.includes(role) && !allowedProfile) {
      return [{ kind: "reply_text", text: "Somente admin/owner podem vincular aliases." }];
    }

    try {
      const result = await deps.ports.identity.linkAlias({
        tenantId: ctx.event.tenantId,
        phoneNumber,
        lidJid,
        actor: ctx.event.waUserId
      });
      const resolvedProfile = result.relationshipProfile ?? ctx.relationshipProfile;
      const resolvedRole = result.permissionRole ?? ctx.identity?.permissionRole ?? ctx.identity?.role;
      const lines = [
        "Alias vinculado com sucesso.",
        `Telefone: ${result.canonicalIdentity.phoneNumber ?? phoneNumber}`,
        `LID: ${result.canonicalIdentity.lidJid ?? lidJid}`,
        `Perfil: ${resolvedProfile ?? "n/d"}`,
        `Permissão: ${resolvedRole ?? "n/d"}`
      ];
      return [{ kind: "reply_text", text: lines.join("\n") }];
    } catch (error) {
      return [{ kind: "reply_text", text: `Falha ao vincular alias: ${(error as Error).message}` }];
    }
  }

  if (commandKey === "whoami") {
    const summary = await formatIdentity(ctx.event.waUserId, ctx.event.waGroupId);
    const lines = [summary];
    lines.push(`Admin/root: ${deps.isRequesterAdmin(ctx) ? "sim" : "não"}`);
    if (ctx.event.isGroup) {
      lines.push(
        `Grupo: ${ctx.event.waGroupId ?? "-"}`,
        `Grupo permitido: ${ctx.groupAllowed ? "sim" : "não"}`,
        `Modo de chat: ${ctx.groupChatMode}`,
        `Bot admin: ${botAdminLabel}`
      );
    }
    return [{ kind: "reply_text", text: deps.stylizeReply(ctx, lines.join("\n")) }];
  }

  if (commandKey === "userinfo") {
    const target = resolveTargetUserFromMentionOrReply(ctx.event);
    if (!target) return [{ kind: "reply_text", text: `Responda ou mencione um usuário para usar ${formatCmd("userinfo")}.` }];
    const summary = await formatIdentity(target, ctx.event.waGroupId);
    return [{ kind: "reply_text", text: summary }];
  }

  if (commandKey === "status") {
    if (!deps.ports.status) return [{ kind: "reply_text", text: "Status não disponível." }];
    const status = await deps.ports.status.getStatus({
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId
    });
    const isRoot = deps.hasRootPrivilege(ctx);
    const profileLabel = ctx.identity?.relationshipProfile ?? ctx.relationshipProfile;
    const lines = ["📊 Status do bot:"];
    if (isRoot) {
      lines.push(`Contexto: ROOT${profileLabel === "creator_root" ? " (criador)" : ""}. Todos os comandos administrativos liberados.`);
    } else if (profileLabel === "mother_privileged") {
      lines.push("Contexto: contato privilegiado (mãe). Mantendo respostas respeitosas e carinhosas.");
    }
    lines.push(
      `Gateway: ${status.gateway.ok ? "ok" : "erro"}${status.gateway.at ? ` (${status.gateway.at})` : ""}`,
      `Worker: ${status.worker.ok ? "ok" : "erro"}${status.worker.at ? ` (${status.worker.at})` : ""}`,
      `DB: ${status.db.ok ? "ok" : "erro"}`,
      `Redis: ${status.redis.ok ? "ok" : "erro"}`,
      `LLM: ${status.llm.enabled ? (status.llm.ok ? "ok" : `erro (${status.llm.reason ?? "desconhecido"})`) : "desativado"}`,
      `Tarefas abertas: ${status.counts.tasksOpen}`,
      `Lembretes agendados: ${status.counts.remindersScheduled}`,
      `Timers agendados: ${status.counts.timersScheduled}`
    );
    if (status.queue) {
      lines.push(`Fila: waiting=${status.queue.waiting ?? 0}, active=${status.queue.active ?? 0}, delayed=${status.queue.delayed ?? 0}`);
    }
    return [{ kind: "reply_text", text: lines.join("\n") }];
  }

  return null;
};

const handleReminderCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps, usageFor } = runtime;
  const reminderHandled = await handleReminderCommand({
    commandKey,
    cmd,
    ctx,
    deps: {
      remindersRepository: deps.ports.remindersRepository,
      timezone: ctx.timezone,
      defaultReminderTime: ctx.defaultReminderTime,
      now: ctx.now,
      formatUsage: () => usageFor("reminder")
    }
  });
  if (reminderHandled) return reminderHandled;
  return null;
};

const handleUnknownCommandFallback = (runtime: RouterRuntime): ResponseAction[] => {
  const { ctx, deps, parsed, match, commandKey, usageForToken, usageFor, formatCmd } = runtime;
  if (!match) {
    const partialUsage = usageForToken(parsed.token);
    if (partialUsage) return [{ kind: "reply_text", text: partialUsage }];
    return [{ kind: "reply_text", text: deps.stylizeReply(ctx, `Comando desconhecido. Use ${formatCmd("help")}.`) }];
  }

  const fallbackUsage = usageForToken(commandKey.split(/\s+/)[0] ?? parsed.token);
  if (fallbackUsage) return [{ kind: "reply_text", text: fallbackUsage }];

  const matchedUsage = usageFor(commandKey);
  if (matchedUsage) return [{ kind: "reply_text", text: matchedUsage }];
  return [{ kind: "reply_text", text: deps.stylizeReply(ctx, `Comando desconhecido. Use ${formatCmd("help")}.`) }];
};

export const runCommandRouter = async (ctx: PipelineContext, deps: CommandRouterDeps): Promise<ResponseAction[]> => {
  const commandStartedAt = deps.ports.clock?.now?.() ?? new Date();
  const parsed = parseCommandText(ctx.event.normalizedText, deps.commandRegistry);
  if (!parsed) return [];

  const runtime = createRouterRuntime(ctx, deps, parsed, commandStartedAt);
  const stages = [
    handleGroupAndAdminCommands,
    handleModuleCommands,
    handleUtilityCommands,
    handleIdentityAndStatusCommands,
    handleReminderCommands
  ];

  for (const stage of stages) {
    const handled = await stage(runtime);
    if (handled) return handled;
  }

  return handleUnknownCommandFallback(runtime);
};
