import { parseCommandText } from "../commands/parser/parse-command.js";
import type { CommandRegistry } from "../commands/registry/command-types.js";
import type { CorePorts } from "../pipeline/ports.js";
import type { PipelineContext } from "../pipeline/context.js";
import type { ResponseAction } from "../pipeline/actions.js";
import type { GroupAccessState } from "../pipeline/types.js";
import { createRouterRuntime } from "./command-router-runtime.js";
import { commandRouterStages, handleUnknownCommandFallback } from "./command-router-stages.js";

const COMMAND_IDEMPOTENCY_TTL_SECONDS = 30;

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

export type ParsedCommand = NonNullable<ReturnType<typeof parseCommandText>>;

export interface RouterRuntime {
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
  buildHelpResponse: () => string;
  formatGroupAccessBotAdmin: (group: GroupAccessState, now: Date) => string;
}

const normalizeCommandKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_:-]/g, "")
    .slice(0, 80);

const buildCommandIdempotencyKey = (input: {
  tenantId: string;
  waMessageId: string;
  commandName: string;
}): string => `cmd:idempotency:${input.tenantId}:${input.waMessageId}:${normalizeCommandKey(input.commandName)}`;

export const runCommandRouter = async (ctx: PipelineContext, deps: CommandRouterDeps): Promise<ResponseAction[]> => {
  const commandStartedAt = deps.ports.clock?.now?.() ?? new Date();
  const parsed = parseCommandText(ctx.event.normalizedText, deps.commandRegistry);
  if (!parsed) return [];

  const commandName = parsed.match?.command.name ?? parsed.token;
  const idempotencyKey = buildCommandIdempotencyKey({
    tenantId: ctx.event.tenantId,
    waMessageId: ctx.event.waMessageId,
    commandName
  });

  let canExecute = true;
  try {
    canExecute = await deps.ports.cooldown.canFire(idempotencyKey, COMMAND_IDEMPOTENCY_TTL_SECONDS);
  } catch (error) {
    deps.ports.logger?.warn?.(
      {
        category: "COMMAND_TRACE",
        status: "command_idempotency_check_failed",
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        waMessageId: ctx.event.waMessageId,
        executionId: ctx.event.executionId,
        commandName,
        commandIdempotencyKey: idempotencyKey,
        err: error
      },
      "command idempotency guard failed; allowing execution"
    );
  }

  if (!canExecute) {
    deps.ports.logger?.info?.(
      {
        category: "COMMAND_TRACE",
        status: "command_idempotency_hit",
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        waMessageId: ctx.event.waMessageId,
        executionId: ctx.event.executionId,
        commandName,
        commandIdempotencyKey: idempotencyKey,
        ttlSeconds: COMMAND_IDEMPOTENCY_TTL_SECONDS
      },
      "command idempotency hit"
    );
    deps.ports.logger?.info?.(
      {
        category: "COMMAND_TRACE",
        status: "command_idempotency_suppressed",
        tenantId: ctx.event.tenantId,
        waGroupId: ctx.event.waGroupId,
        waUserId: ctx.event.waUserId,
        waMessageId: ctx.event.waMessageId,
        executionId: ctx.event.executionId,
        commandName,
        commandIdempotencyKey: idempotencyKey
      },
      "duplicate command execution suppressed"
    );
    return [{ kind: "noop", reason: "command_idempotency_suppressed" }];
  }

  deps.ports.logger?.info?.(
    {
      category: "COMMAND_TRACE",
      status: "command_idempotency_miss",
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId,
      waMessageId: ctx.event.waMessageId,
      executionId: ctx.event.executionId,
      commandName,
      commandIdempotencyKey: idempotencyKey,
      ttlSeconds: COMMAND_IDEMPOTENCY_TTL_SECONDS
    },
    "command idempotency miss"
  );

  const runtime = createRouterRuntime(ctx, deps, parsed, commandStartedAt);
  for (const stage of commandRouterStages) {
    const handled = await stage(runtime);
    if (handled) return handled;
  }

  return handleUnknownCommandFallback(runtime);
};
