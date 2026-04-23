export type PreSalesReadiness = "placeholder_only" | "seeded_v1";

export interface ServiceCategory {
  id: string;
  title: string;
  shortDescription: string;
  keywords: string[];
}

export interface ServiceOffering {
  id: string;
  title: string;
  shortDescription: string;
  detailedDescription: string;
  categoryId: string;
  keywords: string[];
  clientProblemExamples: string[];
  safeForBasicQuoteOrientation: boolean;
  recommendedNextStep: string;
}

export interface PreSalesFAQ {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  relatedCategoryIds?: string[];
  nextStepHint?: string;
}

export interface InquiryCategory {
  id: string;
  title: string;
  description: string;
  keywords: string[];
}

export interface CommercialResponseTemplate {
  id: string;
  description: string;
  template: string;
}

export interface PreSalesKnowledgeVersions {
  readiness: PreSalesReadiness;
  catalogVersion: string;
  faqVersion: string;
  triageVersion: string;
  templatesVersion: string;
}

export interface PreSalesKnowledgeBase {
  schemaVersion: string;
  source: "services_net_seed";
  versions: PreSalesKnowledgeVersions;
  serviceCategories: ServiceCategory[];
  serviceOfferings: ServiceOffering[];
  faqEntries: PreSalesFAQ[];
  inquiryCategories: InquiryCategory[];
  responseTemplates: CommercialResponseTemplate[];
}

export interface KeywordMatchScore {
  score: number;
  matchedKeywords: string[];
}

export type MatchConfidence = "none" | "low" | "medium" | "high";

export interface ServiceOfferingMatch {
  offering: ServiceOffering;
  category: ServiceCategory;
  score: number;
  confidence: MatchConfidence;
  matchedKeywords: string[];
}

export interface FaqMatch {
  entry: PreSalesFAQ;
  score: number;
  confidence: MatchConfidence;
  matchedKeywords: string[];
}

export interface InquiryCategoryMatch {
  category: InquiryCategory;
  score: number;
  confidence: MatchConfidence;
  matchedKeywords: string[];
}

export interface PreSalesTriageResult {
  normalizedText: string;
  isPreSalesCandidate: boolean;
  explicitBrandMention: boolean;
  businessCueDetected: boolean;
  serviceMatch: ServiceOfferingMatch | null;
  faqMatch: FaqMatch | null;
  inquiryCategoryMatch: InquiryCategoryMatch | null;
  confidence: MatchConfidence;
  reasons: string[];
}

export interface PreSalesResponseResolution {
  handled: boolean;
  text?: string;
  reason?: string;
  responseKind?: "faq" | "overview" | "scope_match" | "quote_orientation" | "attendance_flow" | "scope_uncertain";
  matchedServiceCategoryId?: string;
  matchedServiceOfferingId?: string;
  matchedFaqId?: string;
}
