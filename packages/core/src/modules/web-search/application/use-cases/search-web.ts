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
    command: "search" | "google";
    action: "search";
    status: "success" | "failure";
    query: string;
    provider?: string;
    requestedProvider?: string;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    correctedQuery?: string;
    resultsCount?: number;
    reason?: string;
  }
) => {
  logger?.info?.(
    {
      capability: "web-search",
      command: payload.command,
      action: payload.action,
      status: payload.status,
      queryPreview: shorten(payload.query, 120),
      provider: payload.provider,
      requestedProvider: payload.requestedProvider,
      fallbackUsed: payload.fallbackUsed,
      fallbackReason: payload.fallbackReason,
      correctedQuery: payload.correctedQuery,
      resultsCount: payload.resultsCount,
      reason: payload.reason
    },
    "web-search capability"
  );
};

export const executeWebSearch = async (input: {
  command: "search" | "google";
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
  const isGoogleCommand = input.command === "google";
  const mode = isGoogleCommand ? "google_strict" : "generic";

  try {
    const result = await input.search.search({
      query: normalizedQuery,
      limit,
      mode
    });

    if (isGoogleCommand && result.fallbackReason === "google_not_configured") {
      logWebSearch(input.logger, {
        command: input.command,
        action: "search",
        status: "success",
        query: normalizedQuery,
        provider: result.provider,
        requestedProvider: result.requestedProvider,
        fallbackUsed: Boolean(result.fallbackUsed),
        fallbackReason: result.fallbackReason,
        correctedQuery: result.correctedQuery,
        resultsCount: 0
      });
      return replyText(
        "Busca Google não está configurada neste ambiente. Defina GOOGLE_SEARCH_API_KEY e GOOGLE_SEARCH_ENGINE_ID (ou GOOGLE_SEARCH_CX)."
      );
    }

    if (!result.results.length) {
      logWebSearch(input.logger, {
        command: input.command,
        action: "search",
        status: "success",
        query: normalizedQuery,
        provider: result.provider,
        requestedProvider: result.requestedProvider,
        fallbackUsed: Boolean(result.fallbackUsed),
        fallbackReason: result.fallbackReason,
        correctedQuery: result.correctedQuery,
        resultsCount: 0
      });
      const maybeCorrected =
        result.correctedQuery && result.correctedQuery.toLowerCase() !== normalizedQuery.toLowerCase()
          ? ` (consulta ajustada: ${result.correctedQuery})`
          : "";
      return replyText(`Nenhum resultado encontrado para: ${normalizedQuery}${maybeCorrected}`);
    }

    const selected = result.results.slice(0, limit);
    const correctedLine =
      result.correctedQuery && result.correctedQuery.toLowerCase() !== normalizedQuery.toLowerCase()
        ? [`Consulta ajustada: ${result.correctedQuery}`]
        : [];
    const fallbackLine = result.fallbackUsed
      ? [`Fallback aplicado: ${result.fallbackReason ?? "provider_alternativo"} (${result.provider})`]
      : [];
    const lines = [
      isGoogleCommand ? `Resultados Google (${result.provider}) para: ${normalizedQuery}` : `Resultados web (${result.provider}) para: ${normalizedQuery}`,
      ...correctedLine,
      ...fallbackLine,
      ...selected.map((item, index) => formatResult(item, index))
    ];

    logWebSearch(input.logger, {
      command: input.command,
      action: "search",
      status: "success",
      query: normalizedQuery,
      provider: result.provider,
      requestedProvider: result.requestedProvider,
      fallbackUsed: Boolean(result.fallbackUsed),
      fallbackReason: result.fallbackReason,
      correctedQuery: result.correctedQuery,
      resultsCount: selected.length
    });

    return [{ kind: "reply_text", text: lines.join("\n") }];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    logWebSearch(input.logger, {
      command: input.command,
      action: "search",
      status: "failure",
      query: normalizedQuery,
      reason: message
    });
    return replyText(`Falha na busca ${isGoogleCommand ? "Google" : "web"}: ${message}.`);
  }
};
