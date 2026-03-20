import { addDurationToNow, isTimeLike, parseDateTimeWithZone, parseDurationInput } from "../../../../time.js";
import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { RemindersRepositoryPort } from "../../ports/reminder-repository.port.js";
import { createReminder } from "../../application/use-cases/create-reminder.js";

export const parseReminderCommand = (
  text: string,
  options: { now: Date; timezone: string; defaultReminderTime: string }
): { remindAt: Date; message: string; pretty: string } | null => {
  const inMatch = text.match(/^reminder\s+in\s+(\S+)\s+(.+)$/i);
  if (inMatch) {
    const duration = parseDurationInput(inMatch[1]);
    const message = inMatch[2]?.trim();
    if (!duration || !message) return null;
    const { date, pretty } = addDurationToNow({ durationMs: duration.milliseconds, timezone: options.timezone, now: options.now });
    return { remindAt: date, message, pretty };
  }

  const atMatch = text.match(/^reminder\s+at\s+(.+)$/i);
  if (!atMatch) return null;

  const tokens = atMatch[1].trim().split(/\s+/);
  if (tokens.length < 2) return null;

  const dateToken = tokens.shift()!;
  let timeToken: string | undefined;
  if (tokens.length >= 1 && isTimeLike(tokens[0])) {
    timeToken = tokens.shift();
  }
  const message = tokens.join(" ").trim();
  if (!message) return null;

  const parsed = parseDateTimeWithZone({
    dateToken,
    timeToken,
    timezone: options.timezone,
    now: options.now,
    defaultTime: options.defaultReminderTime
  });
  if (!parsed) return null;

  return { remindAt: parsed.date, message, pretty: parsed.pretty };
};

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
