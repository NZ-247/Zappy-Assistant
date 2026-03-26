import type {
  DownloadExecutionResult,
  DownloadProviderDetection,
  DownloadProviderDownloadInput,
  DownloadProviderKey,
  DownloadProbeResult,
  LoggerPort,
  MediaDownloadPort
} from "@zappy/core";
import type { DownloadProviderAdapter, DownloadResolveResult } from "./types.js";
import { createYoutubeDownloadProvider, type YoutubeProviderInput } from "./providers/youtube-provider.js";
import { createInstagramDownloadProvider, type InstagramProviderInput } from "./providers/instagram-provider.js";
import { createFacebookDownloadProvider, type FacebookProviderInput } from "./providers/facebook-provider.js";
import { createDirectDownloadProvider, type DirectDownloadProviderInput } from "./providers/direct-provider.js";

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export interface MediaDownloadRouterInput {
  youtube?: YoutubeProviderInput;
  direct?: DirectDownloadProviderInput;
  instagram?: InstagramProviderInput;
  facebook?: FacebookProviderInput;
  logger?: LoggerPort;
  maxBytes?: number;
  providers?: DownloadProviderAdapter[];
}

const mapProbeToLegacyResult = (input: {
  probe: DownloadProbeResult;
  detectedProvider?: DownloadProviderKey;
}): DownloadResolveResult => ({
  provider: input.probe.provider,
  detectedProvider: input.detectedProvider,
  status: input.probe.status,
  reason: input.probe.reason,
  title: input.probe.title,
  canonicalUrl: input.probe.canonicalUrl,
  url: input.probe.canonicalUrl ?? input.probe.sourceUrl,
  mimeType: input.probe.metadata?.mimeType,
  sizeBytes: input.probe.metadata?.sizeBytes
});

const mapExecutionToLegacyResult = (input: {
  execution: DownloadExecutionResult;
  detectedProvider?: DownloadProviderKey;
}): DownloadResolveResult => {
  const primary = input.execution.assets[0];
  return {
    provider: input.execution.provider,
    detectedProvider: input.detectedProvider,
    status: input.execution.status,
    reason: input.execution.reason,
    title: input.execution.title,
    canonicalUrl: input.execution.canonicalUrl,
    url: primary?.directUrl ?? input.execution.canonicalUrl ?? input.execution.sourceUrl,
    mimeType: primary?.mimeType,
    sizeBytes: primary?.sizeBytes,
    asset: primary
  };
};

const resolveProviderFromDetection = (input: {
  providers: DownloadProviderAdapter[];
  url: string;
}): DownloadProviderDetection | null => {
  let winner: DownloadProviderDetection | null = null;
  for (const provider of input.providers) {
    const detected = provider.detect({ url: input.url });
    if (!detected) continue;
    if (!winner || detected.confidence > winner.confidence) {
      winner = detected;
    }
  }
  return winner;
};

const resolveProviderForRequest = (input: {
  providers: DownloadProviderAdapter[];
  explicitProvider?: DownloadProviderKey;
  url: string;
}): {
  provider: DownloadProviderAdapter | null;
  detection?: DownloadProviderDetection | null;
} => {
  if (input.explicitProvider) {
    const explicit = input.providers.find((item) => item.provider === input.explicitProvider) ?? null;
    return {
      provider: explicit,
      detection: null
    };
  }

  const detection = resolveProviderFromDetection({
    providers: input.providers,
    url: input.url
  });
  if (detection) {
    return {
      provider: input.providers.find((item) => item.provider === detection.provider) ?? null,
      detection
    };
  }

  const directFallback = input.providers.find((item) => item.provider === "direct") ?? null;
  return {
    provider: directFallback,
    detection: directFallback
      ? {
          provider: "direct",
          family: "direct",
          normalizedUrl: input.url,
          confidence: 0.01,
          reason: "fallback_direct"
        }
      : null
  };
};

export const createMediaDownloadRouter = (input?: MediaDownloadRouterInput): MediaDownloadPort => {
  const providers =
    input?.providers ??
    [
      createYoutubeDownloadProvider({
        ...input?.youtube,
        logger: input?.youtube?.logger ?? input?.logger
      }),
      createInstagramDownloadProvider({
        ...input?.instagram,
        logger: input?.instagram?.logger ?? input?.logger
      }),
      createFacebookDownloadProvider({
        ...input?.facebook,
        logger: input?.facebook?.logger ?? input?.logger
      }),
      createDirectDownloadProvider(input?.direct)
    ];
  const maxBytes = input?.maxBytes ?? DEFAULT_MAX_BYTES;

  return {
    resolve: async (request) => {
      try {
        const selection = resolveProviderForRequest({
          providers,
          explicitProvider: request.provider,
          url: request.url
        });

        if (!selection.provider) {
          return {
            provider: request.provider ?? "direct",
            detectedProvider: selection.detection?.provider,
            status: "invalid",
            url: request.url,
            reason: "download_provider_not_configured"
          };
        }

        const probe = await selection.provider.probe({
          url: request.url,
          tenantId: request.tenantId,
          waUserId: request.waUserId,
          waGroupId: request.waGroupId
        });

        if (probe.status !== "ready") {
          return mapProbeToLegacyResult({
            probe,
            detectedProvider: selection.detection?.provider
          });
        }

        const downloadRequest: DownloadProviderDownloadInput = {
          url: request.url,
          tenantId: request.tenantId,
          waUserId: request.waUserId,
          waGroupId: request.waGroupId,
          quality: request.quality,
          maxBytes: request.maxBytes ?? maxBytes
        };

        const execution =
          selection.provider.downloadWithProbe
            ? await selection.provider.downloadWithProbe({
                probe,
                request: downloadRequest
              })
            : await selection.provider.download(downloadRequest);

        return mapExecutionToLegacyResult({
          execution,
          detectedProvider: selection.detection?.provider
        });
      } catch (error) {
        return {
          provider: request.provider ?? "direct",
          status: "error",
          url: request.url,
          reason: error instanceof Error ? error.message : "download_router_failed"
        };
      }
    }
  };
};
