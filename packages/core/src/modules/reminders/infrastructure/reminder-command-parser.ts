import { addDurationToNow, isTimeLike, parseDateTimeWithZone, parseDurationInput } from "../../../time.js";

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
