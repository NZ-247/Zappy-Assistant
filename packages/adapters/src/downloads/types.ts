import type { MediaDownloadPort, MediaDownloadProvider } from "@zappy/core";

export type DownloadResolveInput = Parameters<MediaDownloadPort["resolve"]>[0];
export type DownloadResolveResult = Awaited<ReturnType<MediaDownloadPort["resolve"]>>;

export interface MediaDownloadProviderAdapter {
  provider: MediaDownloadProvider;
  resolve(input: DownloadResolveInput): Promise<DownloadResolveResult>;
}
