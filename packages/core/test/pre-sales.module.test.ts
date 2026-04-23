import { strict as assert } from "node:assert";
import test from "node:test";
import { lookupServiceOffering } from "../src/modules/pre-sales/application/use-cases/lookup-service-offering.js";
import { lookupFaq } from "../src/modules/pre-sales/application/use-cases/lookup-faq.js";
import { triageServiceInquiry } from "../src/modules/pre-sales/application/use-cases/triage-service-inquiry.js";
import { generatePreSalesResponse } from "../src/modules/pre-sales/application/use-cases/generate-pre-sales-response.js";
import { SERVICES_NET_PRESALES_KNOWLEDGE_BASE } from "../src/modules/pre-sales/domain/services-net-knowledge-base.js";
import { normalizeForLookup } from "../src/modules/pre-sales/domain/text-normalization.js";

test("service catalog lookup maps network pain points to infraestrutura de redes", () => {
  const normalized = normalizeForLookup("Nosso wifi esta ruim e a rede fica lenta no escritorio");
  const result = lookupServiceOffering(normalized, SERVICES_NET_PRESALES_KNOWLEDGE_BASE);

  assert.ok(result.bestMatch);
  assert.equal(result.bestMatch?.category.id, "infraestrutura_redes");
  assert.equal(result.bestMatch?.offering.id, "offering_infraestrutura_redes");
  assert.notEqual(result.bestMatch?.confidence, "none");
});

test("faq lookup resolves common pre-attendance question about orcamento", () => {
  const original = "Como pedir orcamento?";
  const result = lookupFaq(normalizeForLookup(original), original, SERVICES_NET_PRESALES_KNOWLEDGE_BASE);

  assert.ok(result);
  assert.equal(result?.entry.id, "faq_como_pedir_orcamento");
});

test("triage classifies backup/firewall inquiry under seguranca da informacao", () => {
  const triage = triageServiceInquiry(
    "Preciso melhorar backup e firewall porque estamos preocupados com seguranca",
    SERVICES_NET_PRESALES_KNOWLEDGE_BASE
  );

  assert.equal(triage.isPreSalesCandidate, true);
  assert.equal(triage.serviceMatch?.category.id, "seguranca_informacao");
});

test("response generator returns safe uncertain fallback when service category is unclear", () => {
  const triage = triageServiceInquiry("Trabalham com desenvolvimento mobile?", SERVICES_NET_PRESALES_KNOWLEDGE_BASE);
  const response = generatePreSalesResponse(triage, SERVICES_NET_PRESALES_KNOWLEDGE_BASE);

  assert.equal(response.handled, true);
  assert.equal(response.responseKind, "scope_uncertain");
  assert.match(response.text ?? "", /Posso te ajudar com uma triagem inicial/i);
});

test("quote/orientation response stays grounded and avoids fabricated pricing guarantees", () => {
  const triage = triageServiceInquiry(
    "Preciso de pre-orcamento para melhorar firewall e backup da empresa",
    SERVICES_NET_PRESALES_KNOWLEDGE_BASE
  );
  const response = generatePreSalesResponse(triage, SERVICES_NET_PRESALES_KNOWLEDGE_BASE);

  assert.equal(response.handled, true);
  assert.match(response.text ?? "", /avaliacao tecnica\/comercial/i);
  assert.doesNotMatch(response.text ?? "", /R\$\s*\d/i);
  assert.doesNotMatch(response.text ?? "", /desenvolvimento de aplicativos/i);
});
