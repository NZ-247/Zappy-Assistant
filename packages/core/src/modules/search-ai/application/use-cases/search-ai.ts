import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import type { SearchAiPort } from "../../ports.js";
import { isValidSearchAiQuery, normalizeSearchAiQuery } from "../../domain/search-ai-query.js";

export interface SearchAiUseCaseConfig {
  enabled: boolean;
  maxSources: number;
}

const clampSources = (value: number): number => {
  if (!Number.isFinite(value)) return 4;
  return Math.min(8, Math.max(1, Math.trunc(value)));
};

const shorten = (value: string, max = 180): string => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);

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
  }
) => {
  logger?.info?.(
    {
      capability: "search-ai",
      action: payload.action,
      status: payload.status,
      queryPreview: shorten(payload.query, 120),
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

  try {
    const result = await input.searchAi.search({
      query: normalizedQuery,
      maxSources
    });

    const summary = compactText(result.summary || "");
    const lines: string[] = [
      `Busca assistida (${result.provider}${result.model ? `/${result.model}` : ""}) para: ${normalizedQuery}`
    ];

    if (summary) {
      lines.push(shorten(summary, 1000));
    }

    const topSources = result.sources.slice(0, maxSources);
    if (topSources.length > 0) {
      lines.push("Fontes principais:");
      lines.push(
        ...topSources.map((source, index) => `${index + 1}. ${shorten(source.title || source.url, 120)}\n   ${source.url}`)
      );
    }

    logSearchAi(input.logger, {
      action: "search",
      status: "success",
      query: normalizedQuery,
      provider: result.provider,
      model: result.model,
      sourcesCount: topSources.length,
      responseMode: "summarized"
    });

    return [{ kind: "reply_text", text: lines.join("\n") }];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    logSearchAi(input.logger, {
      action: "search",
      status: "failure",
      query: normalizedQuery,
      reason: message,
      responseMode: "summarized"
    });
    return replyText(`Falha na busca assistida por IA: ${message}.`);
  }
};
