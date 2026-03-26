import type { DownloadExecutionResult, DownloadProbeResult, DownloadProviderDetection, DownloadProviderDownloadInput } from "@zappy/core";
import type { DownloadProviderAdapter } from "../types.js";

const normalizeHost = (rawHost: string): string => rawHost.trim().toLowerCase().replace(/^www\./, "");

const detectFacebookUrl = (url: string): { normalizedUrl: string } | null => {
  try {
    const parsed = new URL(url);
    const host = normalizeHost(parsed.hostname);
    const isSupported = host === "facebook.com" || host === "m.facebook.com" || host === "fb.watch";
    if (!isSupported) return null;
    return {
      normalizedUrl: parsed.toString()
    };
  } catch {
    return null;
  }
};

const blockedReason = "Provider Facebook permanece bloqueado por política de compliance/licenciamento.";

const buildBlockedProbe = (url: string): DownloadProbeResult => ({
  provider: "fb",
  status: "blocked",
  sourceUrl: url,
  reason: blockedReason
});

const buildBlockedExecution = (url: string): DownloadExecutionResult => ({
  provider: "fb",
  status: "blocked",
  sourceUrl: url,
  reason: blockedReason,
  assets: []
});

export const createFacebookDownloadProvider = (): DownloadProviderAdapter => ({
  provider: "fb",
  detect: (input): DownloadProviderDetection | null => {
    const detected = detectFacebookUrl(input.url);
    if (!detected) return null;
    return {
      provider: "fb",
      family: "facebook",
      normalizedUrl: detected.normalizedUrl,
      confidence: 0.97,
      reason: "facebook_link"
    };
  },
  probe: async (input) => {
    const detected = detectFacebookUrl(input.url);
    if (!detected) {
      return {
        provider: "fb",
        status: "invalid",
        sourceUrl: input.url,
        reason: "invalid_facebook_url"
      };
    }
    return buildBlockedProbe(detected.normalizedUrl);
  },
  download: async (input: DownloadProviderDownloadInput): Promise<DownloadExecutionResult> => {
    const detected = detectFacebookUrl(input.url);
    if (!detected) {
      return {
        provider: "fb",
        status: "invalid",
        sourceUrl: input.url,
        reason: "invalid_facebook_url",
        assets: []
      };
    }
    return buildBlockedExecution(detected.normalizedUrl);
  }
});
