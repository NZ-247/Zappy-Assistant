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
  assert.equal((actions?.[0] as { text: string }).text, "ola");
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
  assert.equal((actions?.[0] as { text: string }).text, "hello");
});

test("trl full mode returns writing and pronunciation when available", async () => {
  const actions = await handleTranslationCommand({
    commandKey: "trl",
    cmd: "trl ola |zh-cn|full",
    ctx: {
      event: {}
    } as any,
    deps: {
      textTranslation: {
        translate: async () => ({
          translatedText: "你好",
          transliteration: "Ni hao"
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
  assert.match(text, /Escrita:/i);
  assert.match(text, /Pronuncia:/i);
});
