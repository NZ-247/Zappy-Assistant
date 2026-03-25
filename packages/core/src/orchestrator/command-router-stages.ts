import { addDurationToNow, formatDateTimeInZone, getDayRange, parseDurationInput } from "../time.js";
import { resolveTargetUserFromMentionOrReply } from "../common/bot-common.js";
import { handleGroupCommand } from "../modules/groups/presentation/commands/group-commands.js";
import { handleModerationCommand } from "../modules/moderation/presentation/commands/moderation-commands.js";
import { handleReminderCommand } from "../modules/reminders/presentation/commands/reminder-commands.js";
import { handleTaskCommand } from "../modules/tasks/presentation/commands/task-commands.js";
import { handleNoteCommand } from "../modules/notes/presentation/commands/note-commands.js";
import { handleAudioCommand } from "../modules/tools/audio/presentation/commands/audio-commands.js";
import { handleStickerCommand } from "../modules/tools/stickers/presentation/commands/sticker-commands.js";
import { evaluateExpression } from "../common/math-expression.js";
import { formatAgenda } from "../modules/reminders/infrastructure/agenda-formatter.js";
import type { ResponseAction } from "../pipeline/actions.js";
import type { RouterRuntime } from "./command-router.js";

export const handleGroupAndAdminCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
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
      formatGroupAccessBotAdmin: runtime.formatGroupAccessBotAdmin
    }
  });
  if (groupHandled) return groupHandled;

  if (commandKey === "help") {
    return [{ kind: "reply_text", text: runtime.buildHelpResponse() }];
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

export const handleModuleCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
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

  const audioHandled = handleAudioCommand({
    commandKey,
    ctx,
    deps: {
      config: {
        capabilityEnabled: ctx.audioCapabilityEnabled,
        autoTranscribeInboundAudio: ctx.audioAutoTranscribeEnabled,
        allowDynamicCommandDispatch: ctx.audioCommandDispatchEnabled,
        commandPrefix: deps.commandPrefix
      },
      formatUsage: () => usageFor("transcribe"),
      stylizeReply: (text) => deps.stylizeReply(ctx, text)
    }
  });
  if (audioHandled) return audioHandled;

  const stickerHandled = handleStickerCommand({
    commandKey,
    cmd,
    ctx,
    deps: {
      config: { defaultAuthor: "Zappy-Assistant ;)" },
      formatUsage: (name) => usageFor(name),
      stylizeReply: (text) => deps.stylizeReply(ctx, text)
    }
  });
  if (stickerHandled) return stickerHandled;

  return null;
};

export const handleUtilityCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
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

export const handleIdentityAndStatusCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
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

export const handleReminderCommands = async (runtime: RouterRuntime): Promise<ResponseAction[] | null> => {
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

export const handleUnknownCommandFallback = (runtime: RouterRuntime): ResponseAction[] => {
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

export const commandRouterStages: Array<(runtime: RouterRuntime) => Promise<ResponseAction[] | null>> = [
  handleGroupAndAdminCommands,
  handleModuleCommands,
  handleUtilityCommands,
  handleIdentityAndStatusCommands,
  handleReminderCommands
];
