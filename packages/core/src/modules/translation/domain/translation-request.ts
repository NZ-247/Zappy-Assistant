export interface TranslationCommandInput {
  text: string;
  targetLanguage?: string;
  mode?: "basic" | "full";
}

const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

export const normalizeTranslationText = (value: string): string => value.replace(/\s+/g, " ").trim();

export const normalizeLanguageTag = (value: string): string => value.trim().toLowerCase();

export const isValidLanguageTag = (value: string): boolean => LANGUAGE_PATTERN.test(normalizeLanguageTag(value));

export const normalizeMode = (value?: string): "basic" | "full" => (value?.trim().toLowerCase() === "full" ? "full" : "basic");

export const languageBase = (value: string): string => normalizeLanguageTag(value).split("-")[0] ?? "";

const PORTUGUESE_HINTS = [
  /\bnao\b/i,
  /\bvoce\b/i,
  /\bobrigad[oa]\b/i,
  /\bpor favor\b/i,
  /\bcomo\b/i,
  /\bque\b/i,
  /\besta\b/i,
  /\bola\b/i
];

export const inferSourceLanguageFallback = (text: string): string => {
  const normalized = normalizeTranslationText(text).toLowerCase();
  if (!normalized) return "unknown";
  if (PORTUGUESE_HINTS.some((pattern) => pattern.test(normalized))) return "pt";
  return "unknown";
};

export const isPortugueseLanguage = (value?: string | null): boolean => {
  const base = value ? languageBase(value) : "";
  return base === "pt";
};
