import { strict as assert } from "node:assert";
import test from "node:test";
import { createOpenAiTranslationAdapter } from "../src/translation/openai-translation-adapter.js";

const createClient = (outputs: unknown[]) => {
  let index = 0;
  return {
    responses: {
      create: async () => {
        const next = outputs[index] ?? outputs[outputs.length - 1];
        index += 1;
        return next;
      }
    }
  };
};

test("translation adapter normalizes detected language tag", async () => {
  const adapter = createOpenAiTranslationAdapter({
    model: "gpt-4o-mini",
    client: createClient([{ output_text: "PT-BR" }]) as any
  });

  assert.ok(adapter?.detectLanguage);
  const detected = await adapter!.detectLanguage!({ text: "Ola" });
  assert.equal(detected.language, "pt-br");
});

test("translation adapter maps full mode transliteration/pronunciation", async () => {
  const adapter = createOpenAiTranslationAdapter({
    model: "gpt-4o-mini",
    client: createClient([
      {
        output_text: JSON.stringify({
          translatedText: "你好",
          detectedSourceLanguage: "pt-BR",
          transliteration: "Ni hao",
          pronunciation: "Nii rrau"
        })
      }
    ]) as any
  });

  const translated = await adapter!.translate({
    text: "ola",
    targetLanguage: "zh-cn",
    mode: "full"
  });

  assert.equal(translated.translatedText, "你好");
  assert.equal(translated.detectedSourceLanguage, "pt-br");
  assert.equal(translated.transliteration, "Ni hao");
  assert.equal(translated.pronunciation, "Nii rrau");
});

test("translation adapter falls back to plain output text when provider does not return JSON", async () => {
  const adapter = createOpenAiTranslationAdapter({
    model: "gpt-4o-mini",
    client: createClient([{ output_text: "hello" }]) as any
  });

  const translated = await adapter!.translate({
    text: "ola",
    sourceLanguage: "pt",
    targetLanguage: "en",
    mode: "basic"
  });

  assert.equal(translated.translatedText, "hello");
  assert.equal(translated.targetLanguage, "en");
});
