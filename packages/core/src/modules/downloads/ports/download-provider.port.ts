import type { DownloadProviderKey } from "../domain/download-provider.js";
import type { DownloadExecutionResult, DownloadProbeResult, DownloadProviderDetection } from "../domain/download-contracts.js";

export interface DownloadProviderProbeInput {
  url: string;
  tenantId?: string;
  waUserId?: string;
  waGroupId?: string;
}

export interface DownloadProviderDownloadInput extends DownloadProviderProbeInput {
  quality?: "low" | "medium" | "high" | "best";
  maxBytes?: number;
}

export interface DownloadProviderPort {
  provider: DownloadProviderKey;
  detect(input: { url: string }): DownloadProviderDetection | null;
  probe(input: DownloadProviderProbeInput): Promise<DownloadProbeResult>;
  download(input: DownloadProviderDownloadInput): Promise<DownloadExecutionResult>;
}

export interface DownloadProviderRouterPort {
  detect(input: { url: string }): DownloadProviderDetection | null;
  probe(input: DownloadProviderProbeInput): Promise<DownloadProbeResult>;
  download(input: DownloadProviderDownloadInput): Promise<DownloadExecutionResult>;
}
