import { DateTime } from "luxon";
import { addDurationToNow, parseDateTimeWithZone, parseDurationInput } from "../../../time.js";

export interface NaturalReminderParserInput {
  text: string;
  now: Date;
  timezone: string;
  defaultReminderTime: string;
}

export interface NaturalReminderTimeResult {
  remindAt: Date;
  pretty: string;
}

export interface NaturalReminderInputResult extends NaturalReminderTimeResult {
  message: string;
}

const compactInline = (value: string): string => value.replace(/\s+/g, " ").trim();

const stripDiacritics = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .trim();

const normalizeForMatching = (value: string): string =>
  compactInline(
    stripDiacritics(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}:/\-\s]/gu, " ")
  );

const pad2 = (value: number): string => String(value).padStart(2, "0");

const inRange = (value: number, min: number, max: number): boolean => Number.isFinite(value) && value >= min && value <= max;

const WORD_UNITS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9
};

const WORD_TEENS: Record<string, number> = {
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezasseis: 16,
  dezessete: 17,
  dezassete: 17,
  dezoito: 18,
  dezenove: 19,
  dezanove: 19
};

const WORD_TENS: Record<string, number> = {
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50
};

const DAY_OF_WEEK_MAP: Record<string, number> = {
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  domingo: 7
};

const parsePortugueseNumber = (raw: string): number | null => {
  const normalized = normalizeForMatching(raw).replace(/[^\p{L}\p{N}\s]/gu, " ");
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const direct = WORD_UNITS[normalized] ?? WORD_TEENS[normalized] ?? WORD_TENS[normalized];
  if (direct !== undefined) return direct;

  const noJoinTokens = normalized.split(/\s+/).filter((token) => token && token !== "e");
  if (noJoinTokens.length === 2) {
    const tens = WORD_TENS[noJoinTokens[0]];
    const unit = WORD_UNITS[noJoinTokens[1]];
    if (tens !== undefined && unit !== undefined) return tens + unit;
  }

  return null;
};

const parseSpokenHourMinute = (raw: string): { hour: number; minute: number } | null => {
  const segment = normalizeForMatching(raw).replace(/[^\p{L}\p{N}\s]/gu, " ");
  if (!segment) return null;

  const tokens = segment.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const explicitJoinIndexes = tokens
    .map((token, index) => (token === "e" ? index : -1))
    .filter((index) => index > 0 && index < tokens.length - 1);

  for (const joinIndex of explicitJoinIndexes) {
    const left = tokens.slice(0, joinIndex).join(" ");
    const right = tokens.slice(joinIndex + 1).join(" ");
    const hour = parsePortugueseNumber(left);
    const minute = parsePortugueseNumber(right);
    if (hour === null || minute === null) continue;
    if (inRange(hour, 0, 23) && inRange(minute, 0, 59)) {
      return { hour, minute };
    }
  }

  const single = parsePortugueseNumber(tokens.join(" "));
  if (single !== null && inRange(single, 0, 23)) {
    return { hour: single, minute: 0 };
  }

  return null;
};

const parseDurationTokenFromText = (normalizedText: string): string | null => {
  const match = normalizedText.match(
    /\b(?:daqui|dentro de|em)\s+([a-z0-9]+(?:\s+e\s+[a-z0-9]+)?)\s*(minutos?|mins?|min|m|horas?|hora|h|dias?|dia|d)\b/i
  );
  if (!match) return null;

  const amount = parsePortugueseNumber(match[1] ?? "");
  if (!amount || amount <= 0) return null;

  const unitRaw = (match[2] ?? "").toLowerCase();
  const unit = unitRaw.startsWith("m") ? "m" : unitRaw.startsWith("h") ? "h" : "d";
  return `${amount}${unit}`;
};

const parseTimeTokenFromText = (normalizedText: string): string | null => {
  const colonMatch = normalizedText.match(/\b(\d{1,2})\s*[:h]\s*(\d{1,2})\b/);
  if (colonMatch) {
    const hour = Number.parseInt(colonMatch[1] ?? "", 10);
    const minute = Number.parseInt(colonMatch[2] ?? "", 10);
    if (inRange(hour, 0, 23) && inRange(minute, 0, 59)) return `${hour}:${pad2(minute)}`;
  }

  const spacedWithAs = normalizedText.match(/\b(?:as|a)\s+(\d{1,2})\s+(\d{1,2})\b/);
  if (spacedWithAs) {
    const hour = Number.parseInt(spacedWithAs[1] ?? "", 10);
    const minute = Number.parseInt(spacedWithAs[2] ?? "", 10);
    if (inRange(hour, 0, 23) && inRange(minute, 0, 59)) return `${hour}:${pad2(minute)}`;
  }

  const andDigits = normalizedText.match(/\b(\d{1,2})\s+e\s+(\d{1,2})\b/);
  if (andDigits) {
    const hour = Number.parseInt(andDigits[1] ?? "", 10);
    const minute = Number.parseInt(andDigits[2] ?? "", 10);
    if (inRange(hour, 0, 23) && inRange(minute, 0, 59)) return `${hour}:${pad2(minute)}`;
  }

  const wordSegmentMatch = normalizedText.match(/\b(?:as|a)\s+([a-z\s]{3,60})/i);
  if (wordSegmentMatch?.[1]) {
    const tokens = wordSegmentMatch[1].split(/\s+/).filter(Boolean);
    for (let len = Math.min(tokens.length, 7); len >= 1; len -= 1) {
      const candidate = tokens.slice(0, len).join(" ");
      const parsed = parseSpokenHourMinute(candidate);
      if (parsed && inRange(parsed.hour, 0, 23) && inRange(parsed.minute, 0, 59)) {
        return `${parsed.hour}:${pad2(parsed.minute)}`;
      }
    }
  }

  const hourOnlyWithAs = normalizedText.match(/\b(?:as|a)\s+(\d{1,2})\b/);
  if (hourOnlyWithAs) {
    const hour = Number.parseInt(hourOnlyWithAs[1] ?? "", 10);
    if (inRange(hour, 0, 23)) return String(hour);
  }

  const bareTime = normalizedText.match(/\b(\d{1,2}):(\d{2})\b/);
  if (bareTime) {
    const hour = Number.parseInt(bareTime[1] ?? "", 10);
    const minute = Number.parseInt(bareTime[2] ?? "", 10);
    if (inRange(hour, 0, 23) && inRange(minute, 0, 59)) return `${hour}:${pad2(minute)}`;
  }

  return null;
};

const resolveWeekdayDateToken = (input: {
  weekdayName: string;
  now: Date;
  timezone: string;
  timeToken?: string;
  defaultReminderTime: string;
}): string => {
  const current = DateTime.fromJSDate(input.now).setZone(input.timezone);
  const targetWeekday = DAY_OF_WEEK_MAP[input.weekdayName];
  if (!targetWeekday) return current.toFormat("dd-LL-yyyy");

  let delta = (targetWeekday - current.weekday + 7) % 7;
  let candidate = current.plus({ days: delta });

  const parsedCandidate = parseDateTimeWithZone({
    dateToken: candidate.toFormat("dd-LL-yyyy"),
    timeToken: input.timeToken,
    timezone: input.timezone,
    now: input.now,
    defaultTime: input.defaultReminderTime
  });
  if (parsedCandidate && parsedCandidate.date.getTime() <= input.now.getTime()) {
    delta = delta === 0 ? 7 : delta + 7;
    candidate = current.plus({ days: delta });
  }

  return candidate.toFormat("dd-LL-yyyy");
};

const resolveDateTokenFromText = (input: {
  normalizedText: string;
  now: Date;
  timezone: string;
  timeToken?: string;
  defaultReminderTime: string;
}): string | null => {
  const explicitDate = input.normalizedText.match(/\b(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/);
  if (explicitDate?.[1]) return explicitDate[1].replace(/\//g, "-");

  const current = DateTime.fromJSDate(input.now).setZone(input.timezone);
  if (/\bhoje\b/i.test(input.normalizedText)) {
    return current.toFormat("dd-LL-yyyy");
  }
  if (/\bamanha\b/i.test(input.normalizedText)) {
    return current.plus({ days: 1 }).toFormat("dd-LL-yyyy");
  }

  const weekdayMatch = input.normalizedText.match(/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?\b/i);
  if (weekdayMatch?.[1]) {
    return resolveWeekdayDateToken({
      weekdayName: weekdayMatch[1].toLowerCase(),
      now: input.now,
      timezone: input.timezone,
      timeToken: input.timeToken,
      defaultReminderTime: input.defaultReminderTime
    });
  }

  return null;
};

const removeTimeExpressionsFromMessage = (value: string): string =>
  value
    .replace(/\b(?:daqui|dentro de|em)\s+[a-z0-9]+(?:\s+e\s+[a-z0-9]+)?\s*(?:minutos?|mins?|min|m|horas?|hora|h|dias?|dia|d)\b/gi, " ")
    .replace(/\b(?:hoje|amanh[ãa]|segunda(?:-feira)?|terca(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado(?:-feira)?|sábado(?:-feira)?|domingo)\b/gi, " ")
    .replace(/\b(?:as|às)\s+[a-z0-9]+(?:\s+e\s+[a-z0-9]+){0,2}\b/gi, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/gi, " ")
    .replace(/\b\d{1,2}\s*[:h]\s*\d{1,2}\b/gi, " ")
    .replace(/\b\d{1,2}\s+e\s+\d{1,2}\b/gi, " ");

export const extractNaturalReminderMessage = (text: string): string => {
  const raw = compactInline(text.replace(/^reminder\b/i, ""));
  if (!raw) return "";

  const introStripped = raw
    .replace(
      /^(?:por favor\s+)?(?:cria(?:r)?|crie|agenda(?:r)?|adiciona(?:r)?|programa(?:r)?|coloca(?:r)?|defina?)\s+(?:um\s+|o\s+|uma\s+)?(?:novo\s+)?(?:lembrete|reminder)\s*(?:para mim\s*)?/i,
      ""
    )
    .replace(/^(?:por favor\s+)?(?:me\s+)?(?:lembre|lembra)(?:-me)?\s*(?:de|que)?\s*/i, "")
    .replace(/^(?:um\s+|o\s+|uma\s+)?(?:lembrete|reminder)\s*/i, "");

  const afterTimeRemoved = compactInline(removeTimeExpressionsFromMessage(introStripped));
  const paraSplit = introStripped.split(/\b(?:para|pra)\b/i).map((chunk) => compactInline(chunk)).filter(Boolean);
  const afterLastPara = paraSplit.length > 1 ? paraSplit[paraSplit.length - 1] ?? "" : "";
  const commaSplit = introStripped.split(",").map((chunk) => compactInline(chunk)).filter(Boolean);
  const afterLastComma = commaSplit.length > 1 ? commaSplit[commaSplit.length - 1] ?? "" : "";

  const candidate = afterLastPara || afterLastComma || afterTimeRemoved;
  return compactInline(
    candidate
      .replace(/^[,;:\-\s]+/, "")
      .replace(/^(?:de|que|para|pra|mim)\s+/i, "")
  );
};

export const parseNaturalReminderTimeFromText = (input: NaturalReminderParserInput): NaturalReminderTimeResult | null => {
  const normalized = normalizeForMatching(input.text);
  if (!normalized) return null;

  const durationToken = parseDurationTokenFromText(normalized);
  if (durationToken) {
    const duration = parseDurationInput(durationToken);
    if (duration) {
      const { date, pretty } = addDurationToNow({
        durationMs: duration.milliseconds,
        timezone: input.timezone,
        now: input.now
      });
      return { remindAt: date, pretty };
    }
  }

  const timeToken = parseTimeTokenFromText(normalized) ?? undefined;
  const dateToken =
    resolveDateTokenFromText({
      normalizedText: normalized,
      now: input.now,
      timezone: input.timezone,
      timeToken,
      defaultReminderTime: input.defaultReminderTime
    }) ?? undefined;

  if (!timeToken && !dateToken) return null;

  if (dateToken) {
    const parsed = parseDateTimeWithZone({
      dateToken,
      timeToken,
      timezone: input.timezone,
      now: input.now,
      defaultTime: input.defaultReminderTime
    });
    if (parsed) return { remindAt: parsed.date, pretty: parsed.pretty };
    return null;
  }

  const current = DateTime.fromJSDate(input.now).setZone(input.timezone);
  const todayToken = current.toFormat("dd-LL-yyyy");
  const parsedToday = parseDateTimeWithZone({
    dateToken: todayToken,
    timeToken,
    timezone: input.timezone,
    now: input.now,
    defaultTime: input.defaultReminderTime
  });
  if (!parsedToday) return null;
  if (parsedToday.date.getTime() > input.now.getTime()) {
    return { remindAt: parsedToday.date, pretty: parsedToday.pretty };
  }
  const tomorrowToken = current.plus({ days: 1 }).toFormat("dd-LL-yyyy");
  const parsedTomorrow = parseDateTimeWithZone({
    dateToken: tomorrowToken,
    timeToken,
    timezone: input.timezone,
    now: input.now,
    defaultTime: input.defaultReminderTime
  });
  if (!parsedTomorrow) return null;
  return { remindAt: parsedTomorrow.date, pretty: parsedTomorrow.pretty };
};

export const parseNaturalReminderInput = (input: NaturalReminderParserInput): NaturalReminderInputResult | null => {
  const parsedTime = parseNaturalReminderTimeFromText(input);
  if (!parsedTime) return null;
  const message = extractNaturalReminderMessage(input.text);
  if (!message) return null;
  return { ...parsedTime, message };
};

