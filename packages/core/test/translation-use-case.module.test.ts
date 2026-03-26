import { strict as assert } from "node:assert";
import test from "node:test";
import { handleTranslationCommand } from "../src/modules/translation/presentation/commands/translation-commands.js";

test("trl uses replied text and defaults target to pt for non-pt source", async () => {
  let requestedTarget = "";

  const actions = await handleTranslationCommand({
    commandKey: "trl",
    cmd: "trl",
    ctx: {
      event: {
        quotedWaMessageId: "msg-trl-module-1",
        quotedText: "bonjour"
      }
    } as any,
    deps: {
      textTranslation: {
        detectLanguage: async () => ({ language: "fr" }),
        translate: async (input) => {
          requestedTarget = input.targetLanguage;
          return {
            translatedText: "ola",
            detectedSourceLanguage: "fr"
          };
        }
      },
      config: {
        enabled: true,
        maxTextChars: 1200,
        defaultTargetForPortuguese: "en",
        defaultTargetForOther: "pt"
      }
    }
  });

  assert.equal(requestedTarget, "pt");
  assert.equal(actions?.[0]?.kind, "reply_text");
  assert.equal((actions?.[0] as { text: string }).text, "Tradução: ola");
});

test("trl defaults target to en for pt source", async () => {
  let requestedTarget = "";

  const actions = await handleTranslationCommand({
    commandKey: "trl",
    cmd: "trl ola",
    ctx: {
      event: {}
    } as any,
    deps: {
      textTranslation: {
        detectLanguage: async () => ({ language: "pt-br" }),
        translate: async (input) => {
          requestedTarget = input.targetLanguage;
          return {
            translatedText: "hello",
            detectedSourceLanguage: "pt-br"
          };
        }
      },
      config: {
        enabled: true,
        maxTextChars: 1200,
        defaultTargetForPortuguese: "en",
        defaultTargetForOther: "pt"
      }
    }
  });

  assert.equal(requestedTarget, "en");
  assert.equal((actions?.[0] as { text: string }).text, "Tradução: hello");
});

test("trl replying to audio emits transcribe-then-dispatch action", async () => {
  const actions = await handleTranslationCommand({
    commandKey: "trl",
    cmd: "trl |ar",
    ctx: {
      event: {
        quotedWaMessageId: "msg-trl-module-2",
        quotedMessageType: "audioMessage"
      }
    } as any,
    deps: {
      config: {
        enabled: true,
        maxTextChars: 1200,
        defaultTargetForPortuguese: "en",
        defaultTargetForOther: "pt"
      },
      commandPrefix: "/"
    }
  });

  assert.equal(actions?.[0]?.kind, "audio_transcription");
  const action = actions?.[0] as {
    source: string;
    mode: string;
    allowCommandDispatch?: boolean;
    dispatchTemplate?: string;
  };
  assert.equal(action.source, "quoted");
  assert.equal(action.mode, "transcribe_and_route");
  assert.equal(action.allowCommandDispatch, false);
  assert.equal(action.dispatchTemplate, "/trl {{transcript}} |ar");
});

test("trl from synthetic audio-stt context includes transcription and translation lines", async () => {
  const actions = await handleTranslationCommand({
    commandKey: "trl",
    cmd: "trl hello there |pt",
    ctx: {
      event: {
        ingressSource: "audio_stt",
        sttTranscript: "hello there"
      }
    } as any,
    deps: {
      textTranslation: {
        translate: async () => ({
          translatedText: "ola"
        })
      },
      config: {
        enabled: true,
        maxTextChars: 1200,
        defaultTargetForPortuguese: "en",
        defaultTargetForOther: "pt"
      }
    }
  });

  const text = (actions?.[0] as { text: string }).text;
  assert.match(text, /^Transcrição: hello there\nTradução: ola$/);
});
