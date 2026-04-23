import type { PreSalesKnowledgeBase } from "../../domain/pre-sales-models.js";
import { SERVICES_NET_PRESALES_KNOWLEDGE_BASE } from "../../domain/services-net-knowledge-base.js";

export const getPreSalesKnowledge = (): PreSalesKnowledgeBase => SERVICES_NET_PRESALES_KNOWLEDGE_BASE;
