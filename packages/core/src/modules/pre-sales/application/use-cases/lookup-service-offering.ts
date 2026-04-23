import type { PreSalesKnowledgeBase, ServiceOfferingMatch } from "../../domain/pre-sales-models.js";
import { mergeKeywordScores, resolveConfidenceFromScore, scoreKeywordMatches } from "../../domain/text-normalization.js";

const DEFAULT_LOOKUP_LIMIT = 3;

export interface ServiceLookupResult {
  bestMatch: ServiceOfferingMatch | null;
  rankedMatches: ServiceOfferingMatch[];
}

export const lookupServiceOffering = (
  normalizedText: string,
  knowledgeBase: PreSalesKnowledgeBase,
  options: { limit?: number } = {}
): ServiceLookupResult => {
  const categoryById = new Map(knowledgeBase.serviceCategories.map((item) => [item.id, item]));

  const scored = knowledgeBase.serviceOfferings
    .map((offering) => {
      const category = categoryById.get(offering.categoryId);
      if (!category) return null;

      const offeringSignal = scoreKeywordMatches(normalizedText, [
        offering.title,
        offering.shortDescription,
        offering.detailedDescription,
        ...offering.keywords,
        ...offering.clientProblemExamples
      ]);
      const categorySignal = scoreKeywordMatches(normalizedText, [category.title, category.shortDescription, ...category.keywords]);
      const merged = mergeKeywordScores(offeringSignal, categorySignal);

      return {
        offering,
        category,
        score: merged.score,
        matchedKeywords: merged.matchedKeywords
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item) && item!.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.offering.title.localeCompare(b.offering.title);
    });

  if (!scored.length) {
    return {
      bestMatch: null,
      rankedMatches: []
    };
  }

  const topScore = scored[0]?.score ?? 0;
  const runnerUpScore = scored[1]?.score ?? 0;

  const rankedMatches: ServiceOfferingMatch[] = scored.slice(0, options.limit ?? DEFAULT_LOOKUP_LIMIT).map((item, index) => ({
    offering: item.offering,
    category: item.category,
    score: item.score,
    confidence: resolveConfidenceFromScore(item.score, index === 0 ? runnerUpScore : 0),
    matchedKeywords: item.matchedKeywords
  }));

  return {
    bestMatch: rankedMatches[0] ?? null,
    rankedMatches
  };
};
