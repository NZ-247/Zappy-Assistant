import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import type { WebSearchPort } from "../../ports.js";
import { isValidWebQuery, normalizeWebQuery } from "../../domain/web-search-query.js";

export interface WebSearchUseCaseConfig {
  enabled: boolean;
  maxResults: number;
}

const clampResults = (value: number): number => {
  if (!Number.isFinite(value)) return 3;
  return Math.min(8, Math.max(1, Math.trunc(value)));
};

const shorten = (value: string, max = 160): string => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);

const normalizeInlineText = (value: string): string => value.replace(/\s+/g, " ").trim();

const sanitizeErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "erro desconhecido";
  const message = normalizeInlineText(error.message);
  if (!message) return "erro desconhecido";
  return message.length <= 140 ? message : `${message.slice(0, 137)}...`;
};

const isLowQualitySnippet = (snippet?: string): boolean => {
  const normalized = normalizeInlineText(snippet || "");
  if (!normalized) return true;
  if (normalized.length < 26) return true;
  return /^\.{3,}$/.test(normalized);
};

const formatResult = (item: { title: string; snippet?: string; link: string }, index: number): string => {
  const lines = [`${index + 1}. ${shorten(item.title, 112)}`];
  if (item.snippet && !isLowQualitySnippet(item.snippet)) lines.push(`   ${shorten(item.snippet, 170)}`);
  lines.push(`   ${item.link}`);
  return lines.join("\n");
};

const logWebSearch = (
  logger: LoggerPort | undefined,
  payload: {
    action: "search";
    status: "success" | "failure";
    query: string;
    provider?: string;
    resultsCount?: number;
    reason?: string;
  }
) => {
  logger?.info?.(
    {
      capability: "web-search",
      action: payload.action,
      status: payload.status,
      queryPreview: shorten(payload.query, 120),
      provider: payload.provider,
      resultsCount: payload.resultsCount,
      reason: payload.reason
    },
    "web-search capability"
  );
};

export const executeWebSearch = async (input: {
  query: string;
  search?: WebSearchPort;
  config: WebSearchUseCaseConfig;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}): Promise<ResponseAction[]> => {
  const replyText = (text: string): ResponseAction[] => [{ kind: "reply_text", text: input.stylizeReply ? input.stylizeReply(text) : text }];

  if (!input.config.enabled) {
    return replyText("Busca web está desativada neste ambiente.");
  }

  if (!input.search) {
    return replyText("Busca web não está configurada no runtime atual.");
  }

  const normalizedQuery = normalizeWebQuery(input.query);
  if (!isValidWebQuery(normalizedQuery)) {
    return replyText("Informe um termo de busca com pelo menos 2 caracteres.");
  }

  const limit = clampResults(input.config.maxResults);

  try {
    const result = await input.search.search({
      query: normalizedQuery,
      limit
    });

    if (!result.results.length) {
      logWebSearch(input.logger, {
        action: "search",
        status: "success",
        query: normalizedQuery,
        provider: result.provider,
        resultsCount: 0
      });
      return replyText(`Nenhum resultado encontrado para: ${normalizedQuery}`);
    }

    const selected = result.results.slice(0, limit);
    const lines = [
      `Resultados web (${result.provider}) para: ${normalizedQuery}`,
      ...selected.map((item, index) => formatResult(item, index))
    ];

    logWebSearch(input.logger, {
      action: "search",
      status: "success",
      query: normalizedQuery,
      provider: result.provider,
      resultsCount: selected.length
    });

    return [{ kind: "reply_text", text: lines.join("\n") }];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    logWebSearch(input.logger, {
      action: "search",
      status: "failure",
      query: normalizedQuery,
      reason: message
    });
    return replyText(`Falha na busca web: ${message}.`);
  }
};
