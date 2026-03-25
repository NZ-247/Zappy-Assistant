import type { ResponseAction } from "../../../../pipeline/actions.js";
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

const sanitizeErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "erro desconhecido";
  const message = error.message.trim();
  if (!message) return "erro desconhecido";
  return message.length <= 140 ? message : `${message.slice(0, 137)}...`;
};

const formatResult = (item: { title: string; link: string; imageUrl?: string }, index: number): string => {
  const lines = [`${index + 1}. ${shorten(item.title, 110)}`];
  if (item.imageUrl) lines.push(`   imagem: ${item.imageUrl}`);
  lines.push(`   fonte: ${item.link}`);
  return lines.join("\n");
};

export const executeImageSearch = async (input: {
  query: string;
  imageSearch?: ImageSearchPort;
  config: ImageSearchUseCaseConfig;
  stylizeReply?: (text: string) => string;
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
      return replyText(`Nenhuma imagem encontrada para: ${normalizedQuery}`);
    }

    const lines = [
      `Resultados de imagem (${result.provider}) para: ${normalizedQuery}`,
      ...result.results.slice(0, limit).map((item, index) => formatResult(item, index))
    ];

    return [{ kind: "reply_text", text: lines.join("\n") }];
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return replyText(`Falha na busca por imagens: ${message}.`);
  }
};
