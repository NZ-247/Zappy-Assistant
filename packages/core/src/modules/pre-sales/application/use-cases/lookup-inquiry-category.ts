import type { InquiryCategoryMatch, PreSalesKnowledgeBase } from "../../domain/pre-sales-models.js";
import { resolveConfidenceFromScore, scoreKeywordMatches } from "../../domain/text-normalization.js";

export const lookupInquiryCategory = (normalizedText: string, knowledgeBase: PreSalesKnowledgeBase): InquiryCategoryMatch | null => {
  const ranked = knowledgeBase.inquiryCategories
    .map((category) => {
      const score = scoreKeywordMatches(normalizedText, [category.title, category.description, ...category.keywords]);
      return {
        category,
        score: score.score,
        matchedKeywords: score.matchedKeywords
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.category.id.localeCompare(b.category.id);
    });

  const best = ranked[0];
  if (!best) return null;

  const runnerUpScore = ranked[1]?.score ?? 0;
  return {
    category: best.category,
    score: best.score,
    confidence: resolveConfidenceFromScore(best.score, runnerUpScore),
    matchedKeywords: best.matchedKeywords
  };
};
