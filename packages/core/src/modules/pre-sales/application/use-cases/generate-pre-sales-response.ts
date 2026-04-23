import type {
  CommercialResponseTemplate,
  PreSalesKnowledgeBase,
  PreSalesResponseResolution,
  PreSalesTriageResult,
  ServiceOfferingMatch
} from "../../domain/pre-sales-models.js";

const getTemplate = (knowledgeBase: PreSalesKnowledgeBase, id: string): CommercialResponseTemplate | null =>
  knowledgeBase.responseTemplates.find((item) => item.id === id) ?? null;

const fillTemplate = (template: string, replacements: Record<string, string>): string => {
  let text = template;
  for (const [key, value] of Object.entries(replacements)) {
    text = text.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value);
  }
  return text;
};

const compactLines = (lines: Array<string | undefined | null>): string =>
  lines
    .filter((line): line is string => Boolean(line && line.trim()))
    .map((line) => line.trim())
    .join("\n");

const hasAnyPattern = (value: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(value));

const OVERVIEW_PATTERNS = [/\bo que\b.*\bfaz/i, /\bquais\b.*\bservic/i, /\bque tipo\b.*\bservic/i, /\bsobre\b.*\bservices\b/i];
const ATTENDANCE_PATTERNS = [/\bcomo\b.*\batend/i, /\bfluxo\b.*\batend/i, /\btriagem\b/i, /\bprimeiro contato\b/i];
const QUOTE_PATTERNS = [/\borcament/i, /\bcotac/i, /\bpreco\b/i, /\bvalor\b/i, /\bquanto custa\b/i, /\bproposta\b/i];
const SCOPE_PATTERNS = [
  /\bvoces?\b.*\b(fazem|atendem|trabalham|conseguem)\b/i,
  /\bentra\b.*\bescopo\b/i,
  /\bmeu problema\b/i,
  /\bescopo\b/i
];

const buildOverviewText = (knowledgeBase: PreSalesKnowledgeBase): string => {
  const serviceList = knowledgeBase.serviceCategories.map((item) => item.title).join(", ");
  const overviewTemplate = getTemplate(knowledgeBase, "overview")?.template ?? "A Services.NET atua em {{serviceList}}.";
  const nextStep = getTemplate(knowledgeBase, "next_step")?.template;

  return compactLines([fillTemplate(overviewTemplate, { serviceList }), nextStep]);
};

const buildScopedMatchText = (knowledgeBase: PreSalesKnowledgeBase, serviceMatch: ServiceOfferingMatch): string => {
  const scopeMatchTemplate =
    getTemplate(knowledgeBase, "scope_match")?.template ?? "Pelo que voce descreveu, isso parece alinhado com {{categoryTitle}}.";

  return compactLines([
    fillTemplate(scopeMatchTemplate, { categoryTitle: serviceMatch.category.title }),
    `Atuacao inicial nessa frente: ${serviceMatch.offering.shortDescription}`,
    `Proximo passo recomendado: ${serviceMatch.offering.recommendedNextStep}`
  ]);
};

export const generatePreSalesResponse = (
  triage: PreSalesTriageResult,
  knowledgeBase: PreSalesKnowledgeBase
): PreSalesResponseResolution => {
  if (!triage.isPreSalesCandidate) {
    return {
      handled: false,
      reason: "not_pre_sales_candidate"
    };
  }

  const normalizedText = triage.normalizedText;
  const inquiryId = triage.inquiryCategoryMatch?.category.id;

  const asksOverview = hasAnyPattern(normalizedText, OVERVIEW_PATTERNS) || inquiryId === "company_overview";
  const asksAttendance = hasAnyPattern(normalizedText, ATTENDANCE_PATTERNS) || inquiryId === "attendance_flow";
  const asksQuote = hasAnyPattern(normalizedText, QUOTE_PATTERNS) || inquiryId === "quote_orientation";
  const asksScope = hasAnyPattern(normalizedText, SCOPE_PATTERNS) || inquiryId === "service_scope_check" || inquiryId === "scope_validation";

  if (triage.faqMatch) {
    const faq = triage.faqMatch.entry;
    return {
      handled: true,
      text: compactLines([faq.answer, faq.nextStepHint]),
      responseKind: "faq",
      matchedFaqId: faq.id
    };
  }

  if (asksOverview) {
    return {
      handled: true,
      text: buildOverviewText(knowledgeBase),
      responseKind: "overview"
    };
  }

  if (asksAttendance) {
    const attendanceFlow = getTemplate(knowledgeBase, "attendance_flow")?.template;
    const nextStep = getTemplate(knowledgeBase, "next_step")?.template;

    return {
      handled: true,
      text: compactLines([attendanceFlow, nextStep]),
      responseKind: "attendance_flow"
    };
  }

  if (asksQuote) {
    const quoteBoundary = getTemplate(knowledgeBase, "quote_boundary")?.template;
    const nextStep = getTemplate(knowledgeBase, "next_step")?.template;

    if (triage.serviceMatch && triage.serviceMatch.offering.safeForBasicQuoteOrientation) {
      return {
        handled: true,
        text: compactLines([buildScopedMatchText(knowledgeBase, triage.serviceMatch), quoteBoundary, nextStep]),
        responseKind: "quote_orientation",
        matchedServiceCategoryId: triage.serviceMatch.category.id,
        matchedServiceOfferingId: triage.serviceMatch.offering.id
      };
    }

    const uncertainScope = getTemplate(knowledgeBase, "scope_uncertain")?.template;
    return {
      handled: true,
      text: compactLines([quoteBoundary, uncertainScope, nextStep]),
      responseKind: "quote_orientation"
    };
  }

  if (triage.serviceMatch && asksScope) {
    if (triage.serviceMatch.confidence === "high" || triage.serviceMatch.confidence === "medium") {
      return {
        handled: true,
        text: compactLines([
          buildScopedMatchText(knowledgeBase, triage.serviceMatch),
          "Se quiser, eu continuo com uma triagem comercial inicial para acelerar o encaminhamento."
        ]),
        responseKind: "scope_match",
        matchedServiceCategoryId: triage.serviceMatch.category.id,
        matchedServiceOfferingId: triage.serviceMatch.offering.id
      };
    }
  }

  if (triage.serviceMatch && triage.serviceMatch.confidence === "high" && triage.explicitBrandMention) {
    return {
      handled: true,
      text: compactLines([
        buildScopedMatchText(knowledgeBase, triage.serviceMatch),
        getTemplate(knowledgeBase, "next_step")?.template
      ]),
      responseKind: "scope_match",
      matchedServiceCategoryId: triage.serviceMatch.category.id,
      matchedServiceOfferingId: triage.serviceMatch.offering.id
    };
  }

  const uncertainScope =
    getTemplate(knowledgeBase, "scope_uncertain")?.template ??
    "Posso te ajudar com uma triagem inicial para entender melhor seu cenario e indicar o proximo passo com seguranca.";
  const nextStep = getTemplate(knowledgeBase, "next_step")?.template;

  return {
    handled: true,
    text: compactLines([uncertainScope, nextStep]),
    responseKind: "scope_uncertain"
  };
};
