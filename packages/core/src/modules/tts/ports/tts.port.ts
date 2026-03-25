export type { TextToSpeechPort } from "../../../pipeline/ports.js";

export interface TtsModuleConfigPort {
  enabled: boolean;
  defaultLanguage: string;
  defaultVoice: string;
  maxTextChars: number;
  voiceAliases?: Record<string, string>;
}
