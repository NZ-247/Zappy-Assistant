import { strict as assert } from "node:assert";
import test from "node:test";
import { parseTranslationCommand } from "../src/modules/translation/infrastructure/translation-command-parser.js";

test("parseTranslationCommand resolves explicit text input", () => {
  const parsed = parseTranslationCommand("trl ola |zh-cn|full");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.kind, "text");
  if (parsed.value.kind !== "text") return;
  assert.equal(parsed.value.source, "explicit");
  assert.equal(parsed.value.request.text, "ola");
  assert.equal(parsed.value.request.targetLanguage, "zh-cn");
  assert.equal(parsed.value.request.mode, "full");
});

test("parseTranslationCommand uses replied text when explicit text is missing", () => {
  const parsed = parseTranslationCommand("trl |es", {
    replyContext: {
      quotedWaMessageId: "msg-trl-1",
      quotedText: "bonjour"
    }
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.kind, "text");
  if (parsed.value.kind !== "text") return;
  assert.equal(parsed.value.source, "reply");
  assert.equal(parsed.value.request.text, "bonjour");
  assert.equal(parsed.value.request.targetLanguage, "es");
  assert.equal(parsed.value.request.mode, "basic");
});

test("parseTranslationCommand resolves replied audio when explicit text is missing", () => {
  const parsed = parseTranslationCommand("trl |ar", {
    replyContext: {
      quotedWaMessageId: "msg-trl-2",
      quotedMessageType: "audioMessage"
    }
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.kind, "audio_reply");
  if (parsed.value.kind !== "audio_reply") return;
  assert.equal(parsed.value.source, "quoted");
  assert.equal(parsed.value.targetLanguage, "ar");
});

test("parseTranslationCommand keeps explicit text precedence over replied audio", () => {
  const parsed = parseTranslationCommand("trl traduz isso |en", {
    replyContext: {
      quotedWaMessageId: "msg-trl-3",
      quotedMessageType: "audioMessage"
    }
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.kind, "text");
  if (parsed.value.kind !== "text") return;
  assert.equal(parsed.value.source, "explicit");
  assert.equal(parsed.value.request.text, "traduz isso");
  assert.equal(parsed.value.request.targetLanguage, "en");
});
