import type { MediaDownloadProviderAdapter } from "../types.js";

export const createFacebookDownloadProvider = (): MediaDownloadProviderAdapter => ({
  provider: "fb",
  resolve: async (input) => ({
    provider: "fb",
    status: "blocked",
    url: input.url,
    reason: "Provider Facebook requer permissões oficiais e validação de uso/licença antes de habilitar download."
  })
});
