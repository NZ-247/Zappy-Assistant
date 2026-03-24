import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { RemindersRepositoryPort } from "../../ports.js";
import { createReminder } from "../../application/use-cases/create-reminder.js";
import { parseReminderCommand } from "../../infrastructure/reminder-command-parser.js";

export interface ReminderCommandDeps {
  remindersRepository: RemindersRepositoryPort;
  timezone: string;
  defaultReminderTime: string;
  now: Date;
  formatUsage?: (command: "reminder") => string | null;
}

export const handleReminderCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: ReminderCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps } = input;
  if (commandKey !== "reminder") return null;

  const parsed = parseReminderCommand(cmd, {
    now: deps.now,
    timezone: deps.timezone,
    defaultReminderTime: deps.defaultReminderTime
  });
  if (!parsed) {
    const usage = deps.formatUsage?.("reminder");
    return [{ kind: "reply_text", text: usage ?? "Uso correto: reminder in <duração> <mensagem> ou reminder at <DD-MM[-AAAA]> [HH:MM] <mensagem>" }];
  }

  return createReminder(deps.remindersRepository, {
    tenantId: ctx.event.tenantId,
    waUserId: ctx.event.waUserId,
    waGroupId: ctx.event.waGroupId,
    message: parsed.message,
    remindAt: parsed.remindAt,
    pretty: parsed.pretty,
    timezone: deps.timezone
  });
};
