import type { KeywordMatchScore, MatchConfidence } from "./pre-sales-models.js";

export const normalizeForLookup = (value: string): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

const scoreKeywordWeight = (keyword: string): number => (keyword.includes(" ") ? 2 : 1);

export const scoreKeywordMatches = (normalizedText: string, keywords: string[]): KeywordMatchScore => {
  let score = 0;
  const matched = new Set<string>();
  const seenNormalized = new Set<string>();

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeForLookup(keyword);
    if (!normalizedKeyword || seenNormalized.has(normalizedKeyword)) continue;
    seenNormalized.add(normalizedKeyword);

    if (normalizedText.includes(normalizedKeyword)) {
      score += scoreKeywordWeight(normalizedKeyword);
      matched.add(keyword);
    }
  }

  return {
    score,
    matchedKeywords: [...matched]
  };
};

export const mergeKeywordScores = (...scores: KeywordMatchScore[]): KeywordMatchScore => {
  let score = 0;
  const matched = new Set<string>();
  for (const item of scores) {
    score += item.score;
    for (const keyword of item.matchedKeywords) matched.add(keyword);
  }
  return {
    score,
    matchedKeywords: [...matched]
  };
};

export const resolveConfidenceFromScore = (score: number, runnerUpScore = 0): MatchConfidence => {
  if (score <= 0) return "none";
  if (score >= 5 && score - runnerUpScore >= 1) return "high";
  if (score >= 3) return "medium";
  return "low";
};

export const isQuestionLike = (value: string): boolean => {
  const raw = String(value ?? "");
  if (raw.includes("?")) return true;
  const normalized = normalizeForLookup(raw);
  if (!normalized) return false;

  return [
    "como",
    "qual",
    "quais",
    "o que",
    "que tipo",
    "voces",
    "voce",
    "entra no escopo",
    "quanto",
    "preco",
    "valor",
    "orcamento"
  ].some((token) => normalized.startsWith(token) || normalized.includes(` ${token} `) || normalized.endsWith(` ${token}`));
};

export const uniqueStrings = (items: string[]): string[] => {
  const set = new Set<string>();
  for (const item of items) {
    const normalized = normalizeForLookup(item);
    if (!normalized) continue;
    if (set.has(normalized)) continue;
    set.add(normalized);
  }
  return [...set];
};
