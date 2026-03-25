export type { TextToSpeechPort } from "../../../pipeline/ports.js";
export type { TextTranslationPort } from "../../../pipeline/ports.js";

export interface TtsModuleConfigPort {
  enabled: boolean;
  defaultSourceLanguage: string;
  defaultLanguage: string;
  defaultVoice: string;
  maxTextChars: number;
  sendAsPtt?: boolean;
  voiceAliases?: Record<string, string>;
}
