import { strict as assert } from "node:assert";
import test from "node:test";
import { DateTime } from "luxon";
import { parseNaturalReminderTimeFromText } from "../src/modules/reminders/infrastructure/natural-reminder-parser.js";
import { inferToolIntent } from "../src/modules/assistant-ai/application/use-cases/infer-tool-intent.js";

const NOW = new Date("2026-04-01T12:00:00-04:00");
const TIMEZONE = "America/Cuiaba";
const DEFAULT_REMINDER_TIME = "08:00:00";

const inZone = (date: Date) => DateTime.fromJSDate(date).setZone(TIMEZONE);

test("natural reminder parser handles 'em 5 minutos' from speech text", () => {
  const parsed = parseNaturalReminderTimeFromText({
    text: "cria um lembrete para mim em 5 minutos para tomar meu remédio",
    now: NOW,
    timezone: TIMEZONE,
    defaultReminderTime: DEFAULT_REMINDER_TIME
  });

  assert.ok(parsed);
  if (!parsed) return;
  const deltaMs = parsed.remindAt.getTime() - NOW.getTime();
  assert.ok(deltaMs >= 5 * 60_000 - 1_000);
  assert.ok(deltaMs <= 5 * 60_000 + 1_000);
});

test("natural reminder parser handles absolute clock time 'às 10:21'", () => {
  const parsed = parseNaturalReminderTimeFromText({
    text: "cria um lembrete às 10:21, tomar remédio",
    now: NOW,
    timezone: TIMEZONE,
    defaultReminderTime: DEFAULT_REMINDER_TIME
  });

  assert.ok(parsed);
  if (!parsed) return;
  const zoned = inZone(parsed.remindAt);
  assert.equal(zoned.hour, 10);
  assert.equal(zoned.minute, 21);
  assert.equal(zoned.toFormat("dd/LL/yyyy"), "02/04/2026");
});

test("natural reminder parser handles STT-normalized time variants ('as 10 21' and words)", () => {
  const spacedDigits = parseNaturalReminderTimeFromText({
    text: "cria um lembrete as 10 21 tomar remédio",
    now: NOW,
    timezone: TIMEZONE,
    defaultReminderTime: DEFAULT_REMINDER_TIME
  });
  assert.ok(spacedDigits);
  if (!spacedDigits) return;
  const spacedDigitsZoned = inZone(spacedDigits.remindAt);
  assert.equal(spacedDigitsZoned.hour, 10);
  assert.equal(spacedDigitsZoned.minute, 21);

  const spokenWords = parseNaturalReminderTimeFromText({
    text: "cria um lembrete às dez e vinte e um tomar remédio",
    now: NOW,
    timezone: TIMEZONE,
    defaultReminderTime: DEFAULT_REMINDER_TIME
  });
  assert.ok(spokenWords);
  if (!spokenWords) return;
  const spokenWordsZoned = inZone(spokenWords.remindAt);
  assert.equal(spokenWordsZoned.hour, 10);
  assert.equal(spokenWordsZoned.minute, 21);
});

test("natural reminder parser handles 'amanhã às 8'", () => {
  const parsed = parseNaturalReminderTimeFromText({
    text: "cria um lembrete amanhã às 8 tomar remédio",
    now: NOW,
    timezone: TIMEZONE,
    defaultReminderTime: DEFAULT_REMINDER_TIME
  });

  assert.ok(parsed);
  if (!parsed) return;
  const zoned = inZone(parsed.remindAt);
  assert.equal(zoned.hour, 8);
  assert.equal(zoned.minute, 0);
  assert.equal(zoned.toFormat("dd/LL/yyyy"), "02/04/2026");
});

test("tool-intent asks for reminder time only when it is truly missing", () => {
  const baseCtx = {
    now: NOW,
    timezone: TIMEZONE,
    defaultReminderTime: DEFAULT_REMINDER_TIME
  } as any;

  const clearTimeIntent = inferToolIntent({
    ...baseCtx,
    event: { normalizedText: "cria um lembrete para tomar meu remédio às 10 e 21" }
  });
  assert.ok(clearTimeIntent);
  assert.equal(clearTimeIntent?.action, "create_reminder");
  assert.equal(clearTimeIntent?.missing.includes("remindAt"), false);

  const missingTimeIntent = inferToolIntent({
    ...baseCtx,
    event: { normalizedText: "cria um lembrete para tomar meu remédio" }
  });
  assert.ok(missingTimeIntent);
  assert.equal(missingTimeIntent?.action, "create_reminder");
  assert.equal(missingTimeIntent?.missing.includes("remindAt"), true);
});
