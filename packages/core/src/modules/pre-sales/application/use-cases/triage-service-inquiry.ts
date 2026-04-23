import type { PreSalesKnowledgeBase, PreSalesTriageResult } from "../../domain/pre-sales-models.js";
import { normalizeForLookup, resolveConfidenceFromScore, scoreKeywordMatches } from "../../domain/text-normalization.js";
import { lookupFaq } from "./lookup-faq.js";
import { lookupInquiryCategory } from "./lookup-inquiry-category.js";
import { lookupServiceOffering } from "./lookup-service-offering.js";

const BRAND_PATTERN = /\bservices\s*\.?\s*net\b/i;

const BUSINESS_CUES = [
  "servico",
  "servicos",
  "atendimento",
  "orcamento",
  "cotacao",
  "preco",
  "valor",
  "escopo",
  "infraestrutura",
  "rede",
  "servidor",
  "virtualizacao",
  "automacao",
  "seguranca",
  "gestao"
];

export const triageServiceInquiry = (text: string, knowledgeBase: PreSalesKnowledgeBase): PreSalesTriageResult => {
  const normalizedText = normalizeForLookup(text);

  const explicitBrandMention = BRAND_PATTERN.test(text) || normalizedText.includes("services net");
  const businessCueDetected = scoreKeywordMatches(normalizedText, BUSINESS_CUES).score > 0;

  const inquiryCategoryMatch = lookupInquiryCategory(normalizedText, knowledgeBase);
  const faqMatch = lookupFaq(normalizedText, text, knowledgeBase);
  const serviceLookup = lookupServiceOffering(normalizedText, knowledgeBase);
  const serviceMatch = serviceLookup.bestMatch;

  const reasons: string[] = [];
  if (explicitBrandMention) reasons.push("brand_mention");
  if (businessCueDetected) reasons.push("business_cue");
  if (inquiryCategoryMatch) reasons.push(`inquiry:${inquiryCategoryMatch.category.id}`);
  if (faqMatch) reasons.push(`faq:${faqMatch.entry.id}`);
  if (serviceMatch) reasons.push(`service:${serviceMatch.category.id}`);

  const candidateByScore = (faqMatch?.score ?? 0) >= 2 || (inquiryCategoryMatch?.score ?? 0) >= 2 || (serviceMatch?.score ?? 0) >= 2;
  const candidateBySignals = (explicitBrandMention && Boolean(inquiryCategoryMatch || serviceMatch || faqMatch)) ||
    (businessCueDetected && Boolean((inquiryCategoryMatch?.score ?? 0) > 0 || (serviceMatch?.score ?? 0) > 0 || (faqMatch?.score ?? 0) > 0));

  const isPreSalesCandidate = Boolean(candidateByScore || candidateBySignals);

  const primaryScore = Math.max(faqMatch?.score ?? 0, inquiryCategoryMatch?.score ?? 0, serviceMatch?.score ?? 0);
  const secondaryScore = [faqMatch?.score ?? 0, inquiryCategoryMatch?.score ?? 0, serviceMatch?.score ?? 0]
    .filter((score) => score !== primaryScore)
    .sort((a, b) => b - a)[0] ?? 0;

  return {
    normalizedText,
    isPreSalesCandidate,
    explicitBrandMention,
    businessCueDetected,
    serviceMatch,
    faqMatch,
    inquiryCategoryMatch,
    confidence: resolveConfidenceFromScore(primaryScore, secondaryScore),
    reasons
  };
};
