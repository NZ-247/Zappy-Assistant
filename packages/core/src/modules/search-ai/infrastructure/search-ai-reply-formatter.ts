import type { SearchAiSourceItem } from "../../../pipeline/ports.js";

export interface SearchAiReplyFormatterInput {
  query: string;
  summary: string;
  sources: SearchAiSourceItem[];
  maxSources: number;
}

const MAX_LINE_LENGTH = 92;
const MAX_HEADER_QUERY_CHARS = 80;
const SIMPLE_QUERY_REGEX = /\b(clima|tempo|weather|temperatura|chuva|cotacao|cotação|hora|agora)\b/i;
const ALERT_REGEX = /\b(alerta|importante|atencao|atenção|warning|cuidado)\b/i;

const compactInline = (value: string): string => value.replace(/\s+/g, " ").trim();

const shorten = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, Math.max(1, max - 3))}...`);

const stripMarkdownInline = (value: string): string =>
  value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, "$1 ($2)");

const wrapLine = (value: string, maxChars = MAX_LINE_LENGTH): string[] => {
  const text = compactInline(value);
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    const next = `${current} ${word}`;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
};

const splitSentences = (value: string): string[] =>
  compactInline(value)
    .split(/(?<=[.!?])\s+/)
    .map((item) => compactInline(item))
    .filter(Boolean);

const isNoisePreamble = (line: string): boolean =>
  /^(provider|provedor|modelo|model|engine|motor|powered by|fonte usada|fontes usadas)\s*:?\s*/i.test(line);

const parseSummary = (summary: string): { paragraphs: string[]; bullets: string[]; alerts: string[] } => {
  const lines = summary
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.replace(/^#{1,6}\s+/, ""))
    .map((line) => stripMarkdownInline(line))
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .map((line) => compactInline(line))
    .filter((line) => line && line !== "```")
    .filter((line) => !isNoisePreamble(line))
    .filter((line) => !/^fontes?\s*(principais)?\s*:?\s*$/i.test(line));

  const paragraphs: string[] = [];
  const bullets: string[] = [];
  const alerts: string[] = [];

  for (const line of lines) {
    const bulletMatch = line.match(/^(?:[-*+•▪◦]|\d+[.)])\s+(.+)$/u);
    const content = compactInline((bulletMatch?.[1] ?? line).replace(/^[–—-]\s+/, ""));
    if (!content) continue;
    if (ALERT_REGEX.test(content)) {
      alerts.push(content);
      continue;
    }
    if (bulletMatch) {
      bullets.push(content);
      continue;
    }
    paragraphs.push(content);
  }

  return { paragraphs, bullets, alerts };
};

const uniq = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

const extractAnswerAndBullets = (input: {
  query: string;
  paragraphs: string[];
  bullets: string[];
}): { summaryLine: string; answer: string; bullets: string[] } => {
  const queryWordCount = input.query.trim().split(/\s+/).filter(Boolean).length;
  const simpleQuery = queryWordCount <= 6 || SIMPLE_QUERY_REGEX.test(input.query);
  const answerMaxChars = simpleQuery ? 240 : 560;
  const bulletsMax = simpleQuery ? 2 : 4;

  const paragraphText = compactInline(input.paragraphs.join(" "));
  const sentences = splitSentences(paragraphText);
  const answerParts: string[] = [];
  for (const sentence of sentences) {
    if (!sentence) continue;
    const next = compactInline([...answerParts, sentence].join(" "));
    if (next.length > answerMaxChars && answerParts.length > 0) break;
    if (next.length > answerMaxChars) {
      answerParts.push(shorten(sentence, answerMaxChars));
      break;
    }
    answerParts.push(sentence);
    if (simpleQuery && answerParts.length >= 1) break;
    if (!simpleQuery && answerParts.length >= 2) break;
  }

  if (answerParts.length === 0 && paragraphText) {
    answerParts.push(shorten(paragraphText, answerMaxChars));
  }

  const answer = compactInline(answerParts.join(" "));
  const summaryLine = shorten(splitSentences(answer)[0] ?? answer, simpleQuery ? 110 : 140);

  const bulletCandidates = uniq(
    [
      ...input.bullets,
      ...sentences.slice(answerParts.length),
      ...input.paragraphs.slice(1)
    ]
      .map((item) => compactInline(item))
      .filter((item) => item.length >= 14)
  );

  const bullets = bulletCandidates.slice(0, bulletsMax).map((item) => shorten(item, 160));
  return { summaryLine, answer: answer || "Não consegui gerar uma síntese clara para esta busca.", bullets };
};

const formatSources = (sources: SearchAiSourceItem[], maxSources: number): string[] => {
  const selected = sources.slice(0, Math.max(1, maxSources));
  if (selected.length === 0) return [];
  const lines = ["Fontes:"];
  selected.forEach((source, index) => {
    const title = compactInline(source.title || source.url);
    const url = compactInline(source.url);
    wrapLine(`${index + 1}. ${shorten(title, 120)}`, MAX_LINE_LENGTH).forEach((line) => lines.push(line));
    if (url) lines.push(url);
  });
  return lines;
};

export const formatSearchAiReply = (input: SearchAiReplyFormatterInput): string => {
  const query = compactInline(input.query);
  const parsed = parseSummary(input.summary);
  const extracted = extractAnswerAndBullets({
    query,
    paragraphs: parsed.paragraphs,
    bullets: parsed.bullets
  });
  const alert = parsed.alerts[0] ? shorten(parsed.alerts[0], 190) : "";

  const lines: string[] = [];
  lines.push(`Busca assistida: ${shorten(query, MAX_HEADER_QUERY_CHARS)}`);
  lines.push(`Resumo: ${extracted.summaryLine}`);
  lines.push("");
  lines.push(...wrapLine(extracted.answer));

  if (extracted.bullets.length > 0) {
    lines.push("");
    lines.push("Pontos-chave:");
    for (const bullet of extracted.bullets) {
      lines.push(`- ${bullet}`);
    }
  }

  if (alert) {
    lines.push("");
    lines.push(`Importante: ${alert}`);
  }

  const sourceLines = formatSources(input.sources, input.maxSources);
  if (sourceLines.length > 0) {
    lines.push("");
    lines.push(...sourceLines);
  }

  return lines.join("\n").trim();
};
