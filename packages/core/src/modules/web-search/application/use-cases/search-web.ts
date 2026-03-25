import type { ResponseAction } from "../../../../pipeline/actions.js";
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

const sanitizeErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "erro desconhecido";
  const message = error.message.trim();
  if (!message) return "erro desconhecido";
  return message.length <= 140 ? message : `${message.slice(0, 137)}...`;
};

const formatResult = (item: { title: string; snippet?: string; link: string }, index: number): string => {
  const lines = [`${index + 1}. ${shorten(item.title, 120)}`];
  if (item.snippet) lines.push(`   ${shorten(item.snippet, 180)}`);
  lines.push(`   ${item.link}`);
  return lines.join("\n");
};

export const executeWebSearch = async (input: {
  query: string;
  search?: WebSearchPort;
  config: WebSearchUseCaseConfig;
  stylizeReply?: (text: string) => string;
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
      return replyText(`Nenhum resultado encontrado para: ${normalizedQuery}`);
    }

    const lines = [
      `Resultados web (${result.provider}) para: ${normalizedQuery}`,
      ...result.results.slice(0, limit).map((item, index) => formatResult(item, index))
    ];

    return [{ kind: "reply_text", text: lines.join("\n") }];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return replyText(`Falha na busca web: ${message}.`);
  }
};
