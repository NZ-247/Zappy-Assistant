import { strict as assert } from "node:assert";
import test from "node:test";
import { parseTtsCommand } from "../src/modules/tts/infrastructure/tts-command-parser.js";

test("parseTtsCommand supports explicit text and voice", () => {
  const parsed = parseTtsCommand("tts Bom dia |en|female");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.text, "Bom dia");
  assert.equal(parsed.value.targetLanguage, "en");
  assert.equal(parsed.value.voice, "female");
});

test("parseTtsCommand supports reply text with optional params", () => {
  const parsed = parseTtsCommand("tts |en|male", {
    replyContext: {
      quotedWaMessageId: "msg-tts-1",
      quotedText: "Texto da mensagem respondida"
    }
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.text, "Texto da mensagem respondida");
  assert.equal(parsed.value.targetLanguage, "en");
  assert.equal(parsed.value.voice, "male");
});

test("parseTtsCommand returns incompatible_reply when quote has no text", () => {
  const parsed = parseTtsCommand("tts", {
    replyContext: {
      quotedWaMessageId: "msg-tts-2",
      quotedMessageType: "imageMessage",
      quotedHasMedia: true
    }
  });

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "incompatible_reply");
});
