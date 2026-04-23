import type { FaqMatch, PreSalesKnowledgeBase } from "../../domain/pre-sales-models.js";
import { isQuestionLike, resolveConfidenceFromScore, scoreKeywordMatches } from "../../domain/text-normalization.js";

export const lookupFaq = (normalizedText: string, originalText: string, knowledgeBase: PreSalesKnowledgeBase): FaqMatch | null => {
  const ranked = knowledgeBase.faqEntries
    .map((entry) => {
      const keywordScore = scoreKeywordMatches(normalizedText, [entry.question, ...entry.keywords]);
      return {
        entry,
        score: keywordScore.score,
        matchedKeywords: keywordScore.matchedKeywords
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.id.localeCompare(b.entry.id);
    });

  const best = ranked[0];
  if (!best) return null;

  const runnerUpScore = ranked[1]?.score ?? 0;
  const confidence = resolveConfidenceFromScore(best.score, runnerUpScore);

  // Keep FAQ strict enough to avoid hijacking unrelated chats.
  if (best.score < 2 && !isQuestionLike(originalText)) return null;

  return {
    entry: best.entry,
    score: best.score,
    confidence,
    matchedKeywords: best.matchedKeywords
  };
};
