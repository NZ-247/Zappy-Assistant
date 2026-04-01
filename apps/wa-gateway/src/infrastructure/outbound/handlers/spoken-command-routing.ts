const compactInline = (value: string): string => value.replace(/\s+/g, " ").trim();

const stripDiacritics = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const normalizeForMatching = (value: string): string =>
  compactInline(
    stripDiacritics(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}:/\-\s]/gu, " ")
  );

const sanitizeForCommand = (value: string): string => compactInline(value.replace(/[|]/g, " "));

const buildReminderCommandBody = (transcript: string): string => {
  const cleaned = transcript.replace(/^\s*(?:reminder|lembrete)\b[:\s-]*/i, "").trim();
  return cleaned || transcript.trim();
};

const hasReminderTimeHint = (normalized: string): boolean =>
  /(?:\b(?:daqui|dentro de|em)\b.*\b(?:minutos?|mins?|min|m|horas?|hora|h|dias?|dia|d)\b)|\b(?:hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b|\b\d{1,2}[:h]\d{1,2}\b|\b(?:as|a)\s+\d{1,2}(?:\s+e\s+\d{1,2}|\s+\d{1,2}|:\d{2})?\b|\b\d{1,2}\s+e\s+\d{1,2}\b/i.test(
    normalized
  );

const extractDurationToken = (normalized: string): string | null => {
  const withWords = normalized.match(/\b(?:daqui|dentro de|em|por)\s+(\d{1,4})\s*(segundos?|seg|s|minutos?|mins?|min|m|horas?|hora|h|dias?|dia|d)\b/i);
  if (withWords) {
    const amount = Number.parseInt(withWords[1] ?? "", 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unitRaw = (withWords[2] ?? "").toLowerCase();
    const unit = unitRaw.startsWith("s")
      ? "s"
      : unitRaw.startsWith("m")
        ? "m"
        : unitRaw.startsWith("h")
          ? "h"
          : "d";
    return `${amount}${unit}`;
  }

  const shortcut = normalized.match(/\b(\d{1,4})\s*(s|m|h|d)\b/i);
  if (!shortcut) return null;
  const amount = Number.parseInt(shortcut[1] ?? "", 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (shortcut[2] ?? "m").toLowerCase();
  return `${amount}${unit}`;
};

const extractNoteText = (transcript: string): string =>
  compactInline(transcript.replace(/.*?\b(anota(?:r)?|nota(?:\s+ai|\s+a[ií])?|note|registra)\b\s*(?:que)?/i, ""));

const extractTaskTitle = (transcript: string): string => {
  const afterTaskKeyword = transcript.split(/\b(?:tarefa|task)\b/i)[1] ?? "";
  const preferred = compactInline(afterTaskKeyword.replace(/^(?:de|para|pra|sobre)\s+/i, ""));
  if (preferred) return preferred;
  return compactInline(transcript.replace(/.*?\b(?:cria(?:r)?|adiciona(?:r)?|nova?|registra(?:r)?)\b/i, ""));
};

export type SpokenOperationalCommandResolution =
  | {
      kind: "candidate";
      commandText: string;
      confidence: number;
      reason: string;
    }
  | {
      kind: "follow_up";
      text: string;
      reason: string;
    };

export const resolveSpokenOperationalCommand = (input: {
  transcript: string;
  prefix: string;
}): SpokenOperationalCommandResolution | null => {
  const transcript = sanitizeForCommand(input.transcript);
  if (!transcript) return null;
  const normalized = normalizeForMatching(transcript);
  if (!normalized) return null;

  const hasReminderKeyword = /\b(lembrete|lembra|lembre|lembrar)\b/i.test(normalized);
  if (hasReminderKeyword) {
    const hasCreateVerb =
      /\b(cria|criar|crie|adiciona|adicionar|agenda|agendar|programa|programar|coloca|defina?|quero)\b/i.test(normalized) ||
      normalized.startsWith("lembrete") ||
      normalized.startsWith("me lembre") ||
      normalized.startsWith("me lembra");
    if (hasCreateVerb) {
      if (!hasReminderTimeHint(normalized)) {
        return {
          kind: "follow_up",
          text: "Entendi o lembrete. Para quando devo agendar?",
          reason: "intent_reminder_missing_time"
        };
      }
      return {
        kind: "candidate",
        commandText: `${input.prefix}reminder ${buildReminderCommandBody(transcript)}`.trim(),
        confidence: 0.94,
        reason: "intent_reminder"
      };
    }
  }

  const hasTimerKeyword = /\b(timer|cronometro|temporizador|alarme)\b/i.test(normalized);
  if (hasTimerKeyword) {
    const durationToken = extractDurationToken(normalized);
    if (!durationToken) {
      return {
        kind: "follow_up",
        text: "Entendi o timer. Qual duração devo usar? Ex: 10m.",
        reason: "intent_timer_missing_duration"
      };
    }
    return {
      kind: "candidate",
      commandText: `${input.prefix}timer ${durationToken}`,
      confidence: 0.93,
      reason: "intent_timer"
    };
  }

  if (/\b(lista|listar|mostra|quais)\b.*\b(notas?|anotacoes?)\b/i.test(normalized)) {
    return {
      kind: "candidate",
      commandText: `${input.prefix}note list`,
      confidence: 0.91,
      reason: "intent_note_list"
    };
  }

  if (/\b(anota|anotar|nota|note|registra)\b/i.test(normalized)) {
    const noteText = extractNoteText(transcript);
    if (!noteText) {
      return {
        kind: "follow_up",
        text: "Posso salvar a nota. Qual texto você quer guardar?",
        reason: "intent_note_missing_text"
      };
    }
    return {
      kind: "candidate",
      commandText: `${input.prefix}note ${noteText}`,
      confidence: 0.91,
      reason: "intent_note_add"
    };
  }

  if (/\b(lista|listar|mostra|quais)\b.*\b(tarefas?|tasks?)\b/i.test(normalized)) {
    return {
      kind: "candidate",
      commandText: `${input.prefix}task list`,
      confidence: 0.9,
      reason: "intent_task_list"
    };
  }

  const hasTaskKeyword = /\b(tarefa|task)\b/i.test(normalized);
  if (hasTaskKeyword) {
    const doneId = transcript.match(/\b(?:tsk[0-9a-z]{2,}|[a-f0-9-]{8,})\b/i)?.[0];
    const wantsDone = /\b(conclui|concluir|concluida|concluída|finaliza|finalizar|feito|feita|marca)\b/i.test(normalized);
    if (wantsDone && doneId) {
      return {
        kind: "candidate",
        commandText: `${input.prefix}task done ${doneId}`,
        confidence: 0.89,
        reason: "intent_task_done"
      };
    }

    const wantsCreate = /\b(cria|criar|adiciona|adicionar|nova|novo|registra|registrar)\b/i.test(normalized);
    if (wantsCreate || normalized.startsWith("tarefa")) {
      const title = extractTaskTitle(transcript);
      if (!title) {
        return {
          kind: "follow_up",
          text: "Entendi a tarefa. Qual título você quer usar?",
          reason: "intent_task_missing_title"
        };
      }
      return {
        kind: "candidate",
        commandText: `${input.prefix}task add ${title}`,
        confidence: 0.9,
        reason: "intent_task_add"
      };
    }
  }

  return null;
};
