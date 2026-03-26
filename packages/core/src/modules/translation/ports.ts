export * from "./ports/translation.port.js";

export interface TranslationModuleConfigPort {
  enabled: boolean;
  maxTextChars: number;
  defaultTargetForPortuguese: string;
  defaultTargetForOther: string;
}
