export interface AudioModuleConfigPort {
  capabilityEnabled: boolean;
  autoTranscribeInboundAudio: boolean;
  allowDynamicCommandDispatch: boolean;
  commandPrefix: string;
}

export interface SpeechToTextPort {
  transcribe(input: {
    audio: Buffer;
    mimeType?: string;
    fileName?: string;
    language?: string;
    timeoutMs?: number;
    model?: string;
  }): Promise<{
    text: string;
    model?: string;
    language?: string;
    confidence?: number | null;
    elapsedMs?: number;
  }>;
}
