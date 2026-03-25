import type { MediaDownloadProviderAdapter } from "../types.js";

export const createYoutubeDownloadProvider = (): MediaDownloadProviderAdapter => ({
  provider: "yt",
  resolve: async (input) => ({
    provider: "yt",
    status: "blocked",
    url: input.url,
    reason: "Provider YouTube requer integração oficial específica e verificação de direitos antes de habilitar o download."
  })
});
