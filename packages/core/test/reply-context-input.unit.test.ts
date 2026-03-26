import { strict as assert } from "node:assert";
import test from "node:test";
import {
  resolveAudioInputSource,
  resolvePrimarySegmentTextFromReply,
  resolveTextInputFromExplicitOrReply
} from "../src/common/reply-context-input.js";

test("resolveTextInputFromExplicitOrReply prioritizes explicit args", () => {
  const resolved = resolveTextInputFromExplicitOrReply({
    explicitText: "search term",
    replyContext: {
      quotedWaMessageId: "msg-1",
      quotedText: "quoted text"
    }
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.text, "search term");
  assert.equal(resolved.source, "explicit");
});

test("resolveTextInputFromExplicitOrReply falls back to replied text", () => {
  const resolved = resolveTextInputFromExplicitOrReply({
    explicitText: "   ",
    replyContext: {
      quotedWaMessageId: "msg-2",
      quotedText: "  texto respondido  "
    }
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.text, "texto respondido");
  assert.equal(resolved.source, "reply");
});

test("resolvePrimarySegmentTextFromReply returns incompatible_reply for media-only quotes", () => {
  const resolved = resolvePrimarySegmentTextFromReply({
    segments: [""],
    replyContext: {
      quotedWaMessageId: "msg-3",
      quotedMessageType: "imageMessage",
      quotedHasMedia: true
    }
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) return;
  assert.equal(resolved.reason, "incompatible_reply");
});

test("resolveAudioInputSource chooses quoted audio and rejects incompatible reply", () => {
  const quotedAudio = resolveAudioInputSource({
    replyContext: {
      quotedWaMessageId: "msg-4",
      quotedMessageType: "audioMessage"
    }
  });
  assert.equal(quotedAudio.ok, true);
  if (!quotedAudio.ok) return;
  assert.equal(quotedAudio.source, "quoted");

  const incompatible = resolveAudioInputSource({
    replyContext: {
      quotedWaMessageId: "msg-5",
      quotedMessageType: "videoMessage"
    }
  });
  assert.equal(incompatible.ok, false);
  if (incompatible.ok) return;
  assert.equal(incompatible.reason, "incompatible_reply");
});
