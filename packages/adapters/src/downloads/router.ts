import type { MediaDownloadPort } from "@zappy/core";
import type { MediaDownloadProviderAdapter } from "./types.js";
import { createYoutubeDownloadProvider } from "./providers/youtube-provider.js";
import { createInstagramDownloadProvider } from "./providers/instagram-provider.js";
import { createFacebookDownloadProvider } from "./providers/facebook-provider.js";
import { createDirectDownloadProvider, type DirectDownloadProviderInput } from "./providers/direct-provider.js";

export interface MediaDownloadRouterInput {
  direct?: DirectDownloadProviderInput;
  providers?: MediaDownloadProviderAdapter[];
}

export const createMediaDownloadRouter = (input?: MediaDownloadRouterInput): MediaDownloadPort => {
  const providers =
    input?.providers ??
    [
      createYoutubeDownloadProvider(),
      createInstagramDownloadProvider(),
      createFacebookDownloadProvider(),
      createDirectDownloadProvider(input?.direct)
    ];

  const byProvider = new Map(providers.map((provider) => [provider.provider, provider]));

  return {
    resolve: async (request) => {
      const provider = byProvider.get(request.provider);
      if (!provider) {
        return {
          provider: request.provider,
          status: "invalid",
          url: request.url,
          reason: "Provider de download não configurado."
        };
      }
      return provider.resolve(request);
    }
  };
};
