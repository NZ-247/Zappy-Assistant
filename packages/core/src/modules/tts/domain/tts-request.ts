export interface TtsCommandInput {
  text: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  language?: string;
  voice?: string;
}

const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const VOICE_PATTERN = /^[a-zA-Z0-9_-]{2,40}$/;

export const isValidLanguageTag = (value: string): boolean => LANGUAGE_PATTERN.test(value.trim());

export const isValidVoiceToken = (value: string): boolean => VOICE_PATTERN.test(value.trim());

export const normalizeLanguageTag = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const [base, region] = trimmed.split("-");
  if (!region) return base.toLowerCase();
  return `${base.toLowerCase()}-${region.toUpperCase()}`;
};

const languageBase = (value: string): string => normalizeLanguageTag(value).split("-")[0] ?? "";

export const areLanguagesEquivalent = (left: string, right: string): boolean =>
  normalizeLanguageTag(left) === normalizeLanguageTag(right) || languageBase(left) === languageBase(right);

export const normalizeVoiceToken = (value: string): string => value.trim();

export const resolveVoiceAlias = (input: {
  voice: string;
  aliases?: Record<string, string>;
}): string => {
  const normalized = normalizeVoiceToken(input.voice);
  const key = normalized.toLowerCase();
  const aliases = input.aliases ?? {};
  return aliases[key] ?? normalized;
};
