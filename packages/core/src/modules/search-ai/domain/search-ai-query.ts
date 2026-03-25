export interface SearchAiQuery {
  query: string;
}

export const normalizeSearchAiQuery = (value: string): string => value.replace(/\s+/g, " ").trim();

export const isValidSearchAiQuery = (value: string): boolean => normalizeSearchAiQuery(value).length >= 2;
