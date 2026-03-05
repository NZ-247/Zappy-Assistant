import { DateTime } from "luxon";

export const DEFAULT_TIMEZONE = "America/Cuiaba";
export const DEFAULT_REMINDER_TIME = "08:00:00";
const OUTPUT_FORMAT = "dd/LL/yyyy HH:mm";

export type ParsedDuration = { milliseconds: number; pretty: string };

const timeTokenRegex = /^(\d{1,2})(?::?(\d{2}))?(?::?(\d{2}))?$/;

const normalizeTimeToken = (token: string | undefined, fallback: string): { hour: number; minute: number; second: number } | null => {
  const normalized = (token ?? fallback).toLowerCase().replace("h", ":");
  const parts = normalized.split(":").filter((part) => part.length > 0);
  const match = parts.join(":").match(timeTokenRegex);
  if (!match) return null;
  const hour = Number.parseInt(match[1] ?? "0", 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  const second = Number.parseInt(match[3] ?? "0", 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return { hour, minute, second };
};

const parseDateToken = (token: string, currentYear: number): { day: number; month: number; year: number } | null => {
  const sanitized = token.replace(/\//g, "-");
  const parts = sanitized.split("-").filter(Boolean);
  if (parts.length < 2) return null;
  const [dayStr, monthStr, yearStr] = parts;
  const day = Number.parseInt(dayStr, 10);
  const month = Number.parseInt(monthStr, 10);
  let year = yearStr ? Number.parseInt(yearStr, 10) : currentYear;
  if (year < 100) year += 2000; // allow 2-digit years
  if ([day, month, year].some((n) => Number.isNaN(n))) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year };
};

export const isTimeLike = (token?: string): boolean => {
  if (!token) return false;
  const normalized = token.toLowerCase().replace("h", ":");
  return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(normalized);
};

export const parseDurationInput = (input: string): ParsedDuration | null => {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const minutes = Number.parseInt(value, 10);
    if (minutes <= 0) return null;
    return { milliseconds: minutes * 60_000, pretty: `${minutes}m` };
  }

  const regex = /(\d+)\s*([dhms])/g;
  let match: RegExpExecArray | null;
  let totalMs = 0;
  const parts: string[] = [];

  while ((match = regex.exec(value)) !== null) {
    const amount = Number.parseInt(match[1] ?? "0", 10);
    if (Number.isNaN(amount) || amount <= 0) continue;
    const unit = match[2];
    if (unit === "d") totalMs += amount * 86_400_000;
    else if (unit === "h") totalMs += amount * 3_600_000;
    else if (unit === "m") totalMs += amount * 60_000;
    else if (unit === "s") totalMs += amount * 1_000;
    parts.push(`${amount}${unit}`);
  }

  if (parts.length === 0 || totalMs <= 0) return null;

  return { milliseconds: totalMs, pretty: parts.join(" ") };
};

export const parseDateTimeWithZone = (input: {
  dateToken: string;
  timeToken?: string;
  timezone?: string;
  now?: Date;
  defaultTime?: string;
}): { date: Date; pretty: string } | null => {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const reference = input.now ? DateTime.fromJSDate(input.now) : DateTime.now();
  const current = reference.setZone(timezone);
  const dateParts = parseDateToken(input.dateToken, current.year);
  if (!dateParts) return null;

  const timeParts = normalizeTimeToken(input.timeToken, input.defaultTime ?? DEFAULT_REMINDER_TIME);
  if (!timeParts) return null;

  const dt = DateTime.fromObject(
    {
      year: dateParts.year,
      month: dateParts.month,
      day: dateParts.day,
      hour: timeParts.hour,
      minute: timeParts.minute,
      second: timeParts.second
    },
    { zone: timezone }
  );

  if (!dt.isValid) return null;

  return { date: dt.toJSDate(), pretty: dt.toFormat(OUTPUT_FORMAT) };
};

export const addDurationToNow = (input: {
  durationMs: number;
  timezone?: string;
  now?: Date;
}): { date: Date; pretty: string } => {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const reference = input.now ? DateTime.fromJSDate(input.now) : DateTime.now();
  const dt = reference.setZone(timezone).plus({ milliseconds: input.durationMs });
  return { date: dt.toJSDate(), pretty: dt.toFormat(OUTPUT_FORMAT) };
};

export const formatDateTimeInZone = (date: Date, timezone?: string): string =>
  DateTime.fromJSDate(date).setZone(timezone ?? DEFAULT_TIMEZONE).toFormat(OUTPUT_FORMAT);

export const normalizeTimezone = (zone?: string): string => {
  const candidate = zone ?? DEFAULT_TIMEZONE;
  const dt = DateTime.now().setZone(candidate);
  return dt.isValid ? dt.zoneName : DEFAULT_TIMEZONE;
};
