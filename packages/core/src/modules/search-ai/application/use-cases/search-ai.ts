import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import type { SearchAiPort } from "../../ports.js";
import { isValidSearchAiQuery, normalizeSearchAiQuery } from "../../domain/search-ai-query.js";
import { formatSearchAiReply } from "../../infrastructure/search-ai-reply-formatter.js";

export interface SearchAiUseCaseConfig {
  enabled: boolean;
  maxSources: number;
  provider?: "gemini" | "openai";
  model?: string;
}

const clampSources = (value: number): number => {
  if (!Number.isFinite(value)) return 4;
  return Math.min(8, Math.max(1, Math.trunc(value)));
};

const compactText = (value: string): string => value.replace(/\s+/g, " ").trim();

const sanitizeErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "erro desconhecido";
  const message = compactText(error.message);
  if (!message) return "erro desconhecido";
  return message.length <= 160 ? message : `${message.slice(0, 157)}...`;
};

const logSearchAi = (
  logger: LoggerPort | undefined,
  payload: {
    action: "search";
    status: "success" | "failure";
    query: string;
    provider?: string;
    model?: string;
    sourcesCount?: number;
    responseMode?: string;
    reason?: string;
    executionId?: string;
    latencyMs?: number;
  }
) => {
  logger?.info?.(
    {
      capability: "search-ai",
      action: payload.action,
      status: payload.status,
      executionId: payload.executionId,
      latencyMs: payload.latencyMs,
      provider: payload.provider,
      model: payload.model,
      responseMode: payload.responseMode,
      sourcesCount: payload.sourcesCount,
      reason: payload.reason
    },
    "search-ai capability"
  );
};

export const executeSearchAi = async (input: {
  query: string;
  searchAi?: SearchAiPort;
  config: SearchAiUseCaseConfig;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
  executionId?: string;
}): Promise<ResponseAction[]> => {
  const replyText = (text: string): ResponseAction[] => [{ kind: "reply_text", text: input.stylizeReply ? input.stylizeReply(text) : text }];

  if (!input.config.enabled) {
    logSearchAi(input.logger, {
      action: "search",
      status: "failure",
      query: input.query,
      reason: "search_ai_disabled",
      responseMode: "summarized"
    });
    return replyText("Busca assistida por IA está desativada neste ambiente.");
  }

  if (!input.searchAi) {
    logSearchAi(input.logger, {
      action: "search",
      status: "failure",
      query: input.query,
      reason: "search_ai_provider_missing",
      responseMode: "summarized"
    });
    return replyText("Busca assistida por IA não está configurada no runtime atual.");
  }

  const normalizedQuery = normalizeSearchAiQuery(input.query);
  if (!isValidSearchAiQuery(normalizedQuery)) {
    return replyText("Informe um termo de busca com pelo menos 2 caracteres.");
  }

  const maxSources = clampSources(input.config.maxSources);
  const started = performance.now();

  try {
    const result = await input.searchAi.search({
      query: normalizedQuery,
      maxSources
    });

    const summary = compactText(result.summary || "");
    const topSources = result.sources.slice(0, maxSources);
    const formatted = formatSearchAiReply({
      query: normalizedQuery,
      summary,
      sources: topSources,
      maxSources
    });

    logSearchAi(input.logger, {
      action: "search",
      status: "success",
      query: normalizedQuery,
      provider: result.provider,
      model: result.model,
      sourcesCount: topSources.length,
      executionId: input.executionId,
      latencyMs: Math.round(performance.now() - started),
      responseMode: "summarized"
    });

    return [{ kind: "reply_text", text: formatted }];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    logSearchAi(input.logger, {
      action: "search",
      status: "failure",
      query: normalizedQuery,
      reason: message,
      provider: input.config.provider,
      model: input.config.model,
      sourcesCount: 0,
      executionId: input.executionId,
      latencyMs: Math.round(performance.now() - started),
      responseMode: "summarized"
    });
    if (input.config.provider === "gemini") {
      if (message === "gemini_http_429") return replyText("O Gemini atingiu o limite de pesquisa com o Google. Tente novamente mais tarde.");
      if (message === "gemini_no_grounding") return replyText("O Gemini não forneceu fontes verificáveis do Google para esta consulta.");
      return replyText("A busca com fontes do Google pelo Gemini está indisponível no momento.");
    }
    return replyText(`Falha na busca assistida por IA: ${message}.`);
  }
};
