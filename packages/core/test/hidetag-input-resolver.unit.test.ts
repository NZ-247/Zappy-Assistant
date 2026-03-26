import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveHidetagInput } from "../src/modules/moderation/infrastructure/hidetag-input-resolver.js";

test("hidetag resolver prioritizes explicit text", () => {
  const resolved = resolveHidetagInput({
    explicitText: "aviso importante",
    replyContext: {
      quotedWaMessageId: "msg-1",
      quotedMessageType: "stickerMessage"
    }
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.payload.kind, "text");
  assert.equal(resolved.payload.text, "aviso importante");
});

test("hidetag resolver resolves replied text", () => {
  const resolved = resolveHidetagInput({
    explicitText: "",
    replyContext: {
      quotedWaMessageId: "msg-2",
      quotedText: "texto respondido"
    }
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.payload.kind, "reply_text");
  assert.equal(resolved.payload.text, "texto respondido");
});

test("hidetag resolver resolves replied media kinds", () => {
  const sticker = resolveHidetagInput({
    replyContext: {
      quotedWaMessageId: "msg-3",
      quotedMessageType: "stickerMessage"
    }
  });
  assert.equal(sticker.ok, true);
  if (sticker.ok) assert.equal(sticker.payload.kind, "reply_sticker");

  const audio = resolveHidetagInput({
    replyContext: {
      quotedWaMessageId: "msg-4",
      quotedMessageType: "audioMessage"
    }
  });
  assert.equal(audio.ok, true);
  if (audio.ok) assert.equal(audio.payload.kind, "reply_audio");

  const ptt = resolveHidetagInput({
    replyContext: {
      quotedWaMessageId: "msg-4-ptt",
      quotedMessageType: "audioMessage"
    }
  });
  assert.equal(ptt.ok, true);
  if (ptt.ok) assert.equal(ptt.payload.kind, "reply_audio");
});

test("hidetag resolver rejects unsupported replied media", () => {
  const resolved = resolveHidetagInput({
    replyContext: {
      quotedWaMessageId: "msg-5",
      quotedMessageType: "locationMessage",
      quotedHasMedia: true
    }
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) return;
  assert.equal(resolved.reason, "unsupported_reply_media");
});
