import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { LoggerPort } from "../../../../pipeline/ports.js";
import type { ImageSearchPort } from "../../ports.js";
import { isValidImageQuery, normalizeImageQuery } from "../../domain/image-search-query.js";

export interface ImageSearchUseCaseConfig {
  enabled: boolean;
  maxResults: number;
}

const clampResults = (value: number): number => {
  if (!Number.isFinite(value)) return 3;
  return Math.min(8, Math.max(1, Math.trunc(value)));
};

const shorten = (value: string, max = 140): string => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);

const normalizeInlineText = (value: string): string => value.replace(/\s+/g, " ").trim();

const sanitizeErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "erro desconhecido";
  const message = normalizeInlineText(error.message);
  if (!message) return "erro desconhecido";
  return message.length <= 140 ? message : `${message.slice(0, 137)}...`;
};

const formatResult = (item: { title: string; link: string; imageUrl?: string }, index: number): string => {
  const lines = [`${index + 1}. ${shorten(item.title, 110)}`];
  if (item.imageUrl) lines.push(`   imagem: ${item.imageUrl}`);
  lines.push(`   fonte: ${item.link}`);
  return lines.join("\n");
};

const logImageSearch = (
  logger: LoggerPort | undefined,
  payload: {
    action: "image_search";
    status: "success" | "failure";
    query: string;
    provider?: string;
    resultsCount?: number;
    returnedImage?: boolean;
    reason?: string;
  }
) => {
  logger?.info?.(
    {
      capability: "image-search",
      action: payload.action,
      status: payload.status,
      queryPreview: shorten(payload.query, 120),
      provider: payload.provider,
      resultsCount: payload.resultsCount,
      returnedImage: payload.returnedImage,
      reason: payload.reason
    },
    "image-search capability"
  );
};

export const executeImageSearch = async (input: {
  query: string;
  imageSearch?: ImageSearchPort;
  config: ImageSearchUseCaseConfig;
  stylizeReply?: (text: string) => string;
  logger?: LoggerPort;
}): Promise<ResponseAction[]> => {
  const replyText = (text: string): ResponseAction[] => [{ kind: "reply_text", text: input.stylizeReply ? input.stylizeReply(text) : text }];

  if (!input.config.enabled) {
    return replyText("Busca por imagens está desativada neste ambiente.");
  }

  if (!input.imageSearch) {
    return replyText("Busca por imagens não está configurada no runtime atual.");
  }

  const normalizedQuery = normalizeImageQuery(input.query);
  if (!isValidImageQuery(normalizedQuery)) {
    return replyText("Informe um termo de busca com pelo menos 2 caracteres.");
  }

  const limit = clampResults(input.config.maxResults);

  try {
    const result = await input.imageSearch.search({
      query: normalizedQuery,
      limit
    });

    if (!result.results.length) {
      logImageSearch(input.logger, {
        action: "image_search",
        status: "success",
        query: normalizedQuery,
        provider: result.provider,
        resultsCount: 0,
        returnedImage: false
      });
      return replyText(`Nenhuma imagem encontrada para: ${normalizedQuery}`);
    }

    const selected = result.results.slice(0, limit);
    const primary = selected.find((item) => Boolean(item.imageUrl));

    if (primary?.imageUrl) {
      const secondary = selected.filter((item) => item !== primary).slice(0, 2);
      const captionLines = [
        `${shorten(primary.title, 90)}`,
        `Fonte: ${primary.link}`
      ];
      if (secondary.length > 0) {
        captionLines.push("Mais resultados:");
        captionLines.push(
          ...secondary.map((item, index) => `${index + 2}. ${shorten(item.title, 70)}\n${item.link}`)
        );
      }

      logImageSearch(input.logger, {
        action: "image_search",
        status: "success",
        query: normalizedQuery,
        provider: result.provider,
        resultsCount: selected.length,
        returnedImage: true
      });

      return [
        {
          kind: "reply_image",
          imageUrl: primary.imageUrl,
          caption: captionLines.join("\n")
        }
      ];
    }

    const lines = [
      `Resultados de imagem (${result.provider}) para: ${normalizedQuery}`,
      ...selected.map((item, index) => formatResult(item, index))
    ];

    logImageSearch(input.logger, {
      action: "image_search",
      status: "success",
      query: normalizedQuery,
      provider: result.provider,
      resultsCount: selected.length,
      returnedImage: false
    });

    return [{ kind: "reply_text", text: lines.join("\n") }];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    logImageSearch(input.logger, {
      action: "image_search",
      status: "failure",
      query: normalizedQuery,
      reason: message,
      returnedImage: false
    });
    return replyText(`Falha na busca por imagens: ${message}.`);
  }
};
