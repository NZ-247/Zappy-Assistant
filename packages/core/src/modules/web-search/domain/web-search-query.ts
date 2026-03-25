export interface WebSearchQuery {
  query: string;
}

export const normalizeWebQuery = (value: string): string => value.replace(/\s+/g, " ").trim();

export const isValidWebQuery = (value: string): boolean => normalizeWebQuery(value).length >= 2;
