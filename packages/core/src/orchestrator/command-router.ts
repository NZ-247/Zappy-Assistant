import { parseCommandText } from "../commands/parser/parse-command.js";
import type { CommandRegistry } from "../commands/registry/command-types.js";
import type { CorePorts } from "../pipeline/ports.js";
import type { PipelineContext } from "../pipeline/context.js";
import type { ResponseAction } from "../pipeline/actions.js";
import type { GroupAccessState } from "../pipeline/types.js";
import { createRouterRuntime } from "./command-router-runtime.js";
import { commandRouterStages, handleUnknownCommandFallback } from "./command-router-stages.js";

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

export const runCommandRouter = async (ctx: PipelineContext, deps: CommandRouterDeps): Promise<ResponseAction[]> => {
  const commandStartedAt = deps.ports.clock?.now?.() ?? new Date();
  const parsed = parseCommandText(ctx.event.normalizedText, deps.commandRegistry);
  if (!parsed) return [];

  const runtime = createRouterRuntime(ctx, deps, parsed, commandStartedAt);
  for (const stage of commandRouterStages) {
    const handled = await stage(runtime);
    if (handled) return handled;
  }

  return handleUnknownCommandFallback(runtime);
};
