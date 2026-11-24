export type { SearchAiPort } from "../../../pipeline/ports.js";

export type SearchSourcesRequest = {
  query: string;
  conversationKey: string;
  executionId: string;
  origin: "command" | "conversation";
  maxSources: number;
};

export type SearchWithSources = (input: SearchSourcesRequest) => Promise<string>;
