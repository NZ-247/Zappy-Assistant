export interface ImageSearchQuery {
  query: string;
}

export const normalizeImageQuery = (value: string): string => value.replace(/\s+/g, " ").trim();

export const isValidImageQuery = (value: string): boolean => normalizeImageQuery(value).length >= 2;
