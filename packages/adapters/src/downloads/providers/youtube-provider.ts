import type { DownloadExecutionResult, DownloadProbeResult, DownloadProviderDetection, DownloadProviderDownloadInput } from "@zappy/core";
import type { DownloadProviderAdapter } from "../types.js";

const normalizeHost = (rawHost: string): string => rawHost.trim().toLowerCase().replace(/^www\./, "");

const detectYoutubeUrl = (url: string): { normalizedUrl: string } | null => {
  try {
    const parsed = new URL(url);
    const host = normalizeHost(parsed.hostname);
    const supportedHost = host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
    if (!supportedHost) return null;
    return {
      normalizedUrl: parsed.toString()
    };
  } catch {
    return null;
  }
};

const blockedReason = "Provider YouTube permanece bloqueado por política de compliance/licenciamento.";

const buildBlockedProbe = (url: string): DownloadProbeResult => ({
  provider: "yt",
  status: "blocked",
  sourceUrl: url,
  reason: blockedReason
});

const buildBlockedExecution = (url: string): DownloadExecutionResult => ({
  provider: "yt",
  status: "blocked",
  sourceUrl: url,
  reason: blockedReason,
  assets: []
});

export const createYoutubeDownloadProvider = (): DownloadProviderAdapter => ({
  provider: "yt",
  detect: (input): DownloadProviderDetection | null => {
    const detected = detectYoutubeUrl(input.url);
    if (!detected) return null;
    return {
      provider: "yt",
      family: "youtube",
      normalizedUrl: detected.normalizedUrl,
      confidence: 0.98,
      reason: "youtube_link"
    };
  },
  probe: async (input) => {
    const detected = detectYoutubeUrl(input.url);
    if (!detected) {
      return {
        provider: "yt",
        status: "invalid",
        sourceUrl: input.url,
        reason: "invalid_youtube_url",
        metadata: undefined
      };
    }
    return buildBlockedProbe(detected.normalizedUrl);
  },
  download: async (input: DownloadProviderDownloadInput) => {
    const detected = detectYoutubeUrl(input.url);
    if (!detected) {
      return {
        provider: "yt",
        status: "invalid",
        sourceUrl: input.url,
        reason: "invalid_youtube_url",
        assets: []
      };
    }
    return buildBlockedExecution(detected.normalizedUrl);
  }
});
