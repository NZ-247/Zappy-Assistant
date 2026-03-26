import type { ImageSearchResultItem } from "@zappy/core";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ImageProviderSource = "wikimedia" | "openverse" | "pixabay" | "pexels" | "unsplash" | "google_cse";

export interface ProviderSearchInput {
  query: string;
  limit: number;
  timeoutMs: number;
  fetchImpl: FetchLike;
  locale?: string;
}

export interface ProviderSearchResult {
  results: ImageSearchResultItem[];
  correctedQuery?: string;
}

export interface ImageProviderAdapter {
  source: ImageProviderSource;
  isConfigured: () => boolean;
  search: (input: ProviderSearchInput) => Promise<ProviderSearchResult>;
}
