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

const IMAGE_FALLBACK_TEXT = "Encontrei resultados, mas não consegui baixar uma imagem válida agora. Tente outro termo em instantes.";

const logImageSearch = (
  logger: LoggerPort | undefined,
  payload: {
    action: "image_search";
    status: "success" | "failure";
    query: string;
    provider?: string;
    requestedProvider?: string;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    correctedQuery?: string;
    resultsCount?: number;
    returnedImage?: boolean;
    directImageUrl?: string;
    deliverableCandidateIndex?: number;
    deliverableByteLength?: number;
    rejectedCandidates?: number;
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
      requestedProvider: payload.requestedProvider,
      fallbackUsed: payload.fallbackUsed,
      fallbackReason: payload.fallbackReason,
      correctedQuery: payload.correctedQuery,
      resultsCount: payload.resultsCount,
      returnedImage: payload.returnedImage,
      directImageUrl: payload.directImageUrl,
      deliverableCandidateIndex: payload.deliverableCandidateIndex,
      deliverableByteLength: payload.deliverableByteLength,
      rejectedCandidates: payload.rejectedCandidates,
      reason: payload.reason
    },
    "image-search capability"
  );
};

const logCandidateDiagnostics = (
  logger: LoggerPort | undefined,
  query: string,
  diagnostics: Array<{
    title: string;
    link: string;
    imageUrl: string;
    candidateIndex: number;
    status: "accepted" | "rejected";
    reason: string;
    httpStatus?: number;
    mimeType?: string;
    byteLength?: number;
  }>
) => {
  for (const diagnostic of diagnostics) {
    logger?.info?.(
      {
        capability: "image-search",
        action: "media_candidate",
        queryPreview: shorten(query, 120),
        candidateIndex: diagnostic.candidateIndex,
        status: diagnostic.status,
        reason: diagnostic.reason,
        httpStatus: diagnostic.httpStatus,
        mimeType: diagnostic.mimeType,
        byteLength: diagnostic.byteLength,
        titlePreview: shorten(diagnostic.title, 90),
        sourcePreview: shorten(diagnostic.link, 120),
        imageUrlPreview: shorten(diagnostic.imageUrl, 180)
      },
      diagnostic.status === "accepted" ? "image candidate selected" : "image candidate rejected"
    );
  }
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
        requestedProvider: result.requestedProvider,
        fallbackUsed: Boolean(result.fallbackUsed),
        fallbackReason: result.fallbackReason,
        correctedQuery: result.correctedQuery,
        resultsCount: 0,
        returnedImage: false
      });
      const maybeCorrected =
        result.correctedQuery && result.correctedQuery.toLowerCase() !== normalizedQuery.toLowerCase()
          ? ` (consulta ajustada: ${result.correctedQuery})`
          : "";
      return replyText(`Nenhuma imagem encontrada para: ${normalizedQuery}${maybeCorrected}`);
    }

    logCandidateDiagnostics(input.logger, normalizedQuery, result.candidateDiagnostics ?? []);

    const selected = result.results.slice(0, limit);
    const deliverable = result.deliverableImage;

    if (deliverable?.imageBase64) {
      const secondary = selected.filter((item) => item.imageUrl !== deliverable.imageUrl).slice(0, 2);
      const captionLines = [
        `${shorten(deliverable.title, 90)}`,
        `Fonte: ${deliverable.link}`
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
        requestedProvider: result.requestedProvider,
        fallbackUsed: Boolean(result.fallbackUsed),
        fallbackReason: result.fallbackReason,
        correctedQuery: result.correctedQuery,
        resultsCount: selected.length,
        returnedImage: true,
        directImageUrl: shorten(deliverable.imageUrl, 180),
        deliverableCandidateIndex: deliverable.candidateIndex,
        deliverableByteLength: deliverable.byteLength,
        rejectedCandidates: (result.candidateDiagnostics ?? []).filter((entry) => entry.status === "rejected").length
      });

      return [
        {
          kind: "reply_image",
          imageUrl: deliverable.imageUrl,
          imageBase64: deliverable.imageBase64,
          mimeType: deliverable.mimeType,
          caption: captionLines.join("\n"),
          fallbackText: IMAGE_FALLBACK_TEXT
        }
      ];
    }

    logImageSearch(input.logger, {
      action: "image_search",
      status: "success",
      query: normalizedQuery,
      provider: result.provider,
      requestedProvider: result.requestedProvider,
      fallbackUsed: Boolean(result.fallbackUsed),
      fallbackReason: result.fallbackReason,
      correctedQuery: result.correctedQuery,
      resultsCount: selected.length,
      returnedImage: false,
      rejectedCandidates: (result.candidateDiagnostics ?? []).filter((entry) => entry.status === "rejected").length,
      reason: selected.length > 0 ? "no_valid_media_candidate" : "no_search_results"
    });

    if (!selected.length) {
      return replyText(`Nenhuma imagem encontrada para: ${normalizedQuery}`);
    }

    const correctionNote =
      result.correctedQuery && result.correctedQuery.toLowerCase() !== normalizedQuery.toLowerCase()
        ? ` Consulta ajustada: ${result.correctedQuery}.`
        : "";
    return replyText(`${IMAGE_FALLBACK_TEXT}${correctionNote}`);
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
