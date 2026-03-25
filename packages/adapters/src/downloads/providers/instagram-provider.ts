import type { MediaDownloadProviderAdapter } from "../types.js";

export const createInstagramDownloadProvider = (): MediaDownloadProviderAdapter => ({
  provider: "ig",
  resolve: async (input) => ({
    provider: "ig",
    status: "blocked",
    url: input.url,
    reason: "Provider Instagram requer permissões oficiais da plataforma e checagem de compliance antes de processar mídia."
  })
});
