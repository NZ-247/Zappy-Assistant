import { strict as assert } from "node:assert";
import test from "node:test";
import { parseTranslationCommand } from "../src/modules/translation/infrastructure/translation-command-parser.js";

test("parseTranslationCommand parses explicit target and full mode", () => {
  const parsed = parseTranslationCommand("trl ola |zh-cn|full");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.text, "ola");
  assert.equal(parsed.value.targetLanguage, "zh-cn");
  assert.equal(parsed.value.mode, "full");
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

  assert.equal(parsed.value.text, "bonjour");
  assert.equal(parsed.value.targetLanguage, "es");
  assert.equal(parsed.value.mode, "basic");
});

test("parseTranslationCommand rejects incompatible reply input", () => {
  const parsed = parseTranslationCommand("trl", {
    replyContext: {
      quotedWaMessageId: "msg-trl-2",
      quotedMessageType: "audioMessage"
    }
  });

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "incompatible_reply");
});
