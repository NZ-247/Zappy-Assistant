import type { DownloadProviderKey } from "./download-provider.js";

export type DownloadProviderFamily = "youtube" | "instagram" | "facebook" | "direct";

export interface DownloadProviderDetection {
  provider: DownloadProviderKey;
  family: DownloadProviderFamily;
  normalizedUrl: string;
  confidence: number;
  reason: string;
}

export type DownloadProbeStatus = "ready" | "unsupported" | "blocked" | "invalid" | "error";

export interface DownloadAssetMetadata {
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  durationMs?: number;
  width?: number;
  height?: number;
}

export interface DownloadProbeResult {
  provider: DownloadProviderKey;
  status: DownloadProbeStatus;
  sourceUrl: string;
  canonicalUrl?: string;
  title?: string;
  metadata?: DownloadAssetMetadata;
  reason?: string;
}

export type DownloadAssetKind = "audio" | "video" | "image" | "document";

export interface DownloadOutputAsset {
  kind: DownloadAssetKind;
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  directUrl?: string;
  bufferBase64?: string;
  thumbnailUrl?: string;
}

export interface DownloadExecutionResult {
  provider: DownloadProviderKey;
  status: "ready" | "unsupported" | "blocked" | "invalid" | "error";
  sourceUrl: string;
  canonicalUrl?: string;
  title?: string;
  assets: DownloadOutputAsset[];
  reason?: string;
}
