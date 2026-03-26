import { strict as assert } from "node:assert";
import test from "node:test";
import { handleModerationCommand } from "../src/modules/moderation/presentation/commands/moderation-commands.js";

const buildDeps = () => ({
  requireGroup: () => null,
  requireAdmin: () => null,
  enforceBotAdmin: () => null,
  stylizeReply: (text: string) => text,
  formatCmd: (body: string) => `/${body}`
});

test("hidetag with direct text maps to text payload", () => {
  const actions = handleModerationCommand({
    commandKey: "hidetag",
    lower: "hidetag aviso importante",
    cmd: "hidetag aviso importante",
    ctx: {
      event: {
        waGroupId: "123@g.us"
      }
    } as any,
    deps: buildDeps()
  });

  assert.equal(actions?.[0]?.kind, "moderation_action");
  const action = actions?.[0] as { action: string; text?: string; hidetagContent?: { kind: string } };
  assert.equal(action.action, "hidetag");
  assert.equal(action.text, "aviso importante");
  assert.equal(action.hidetagContent?.kind, "text");
});

test("hidetag replying sticker maps to media payload", () => {
  const actions = handleModerationCommand({
    commandKey: "hidetag",
    lower: "hidetag",
    cmd: "hidetag",
    ctx: {
      event: {
        waGroupId: "123@g.us",
        quotedWaMessageId: "msg-1",
        quotedMessageType: "stickerMessage"
      }
    } as any,
    deps: buildDeps()
  });

  assert.equal(actions?.[0]?.kind, "moderation_action");
  const action = actions?.[0] as { action: string; hidetagContent?: { kind: string } };
  assert.equal(action.action, "hidetag");
  assert.equal(action.hidetagContent?.kind, "reply_sticker");
});

test("hidetag replying audio maps to media payload", () => {
  const actions = handleModerationCommand({
    commandKey: "hidetag",
    lower: "hidetag",
    cmd: "hidetag",
    ctx: {
      event: {
        waGroupId: "123@g.us",
        quotedWaMessageId: "msg-2",
        quotedMessageType: "audioMessage",
        quotedAudioPtt: false
      }
    } as any,
    deps: buildDeps()
  });

  assert.equal(actions?.[0]?.kind, "moderation_action");
  const action = actions?.[0] as { action: string; hidetagContent?: { kind: string } };
  assert.equal(action.action, "hidetag");
  assert.equal(action.hidetagContent?.kind, "reply_audio");
});

test("hidetag replying ptt maps to voice payload kind", () => {
  const actions = handleModerationCommand({
    commandKey: "hidetag",
    lower: "hidetag",
    cmd: "hidetag",
    ctx: {
      event: {
        waGroupId: "123@g.us",
        quotedWaMessageId: "msg-2-ptt",
        quotedMessageType: "audioMessage",
        quotedAudioPtt: true
      }
    } as any,
    deps: buildDeps()
  });

  assert.equal(actions?.[0]?.kind, "moderation_action");
  const action = actions?.[0] as { action: string; hidetagContent?: { kind: string } };
  assert.equal(action.action, "hidetag");
  assert.equal(action.hidetagContent?.kind, "reply_ptt");
});

test("hidetag replying unsupported media returns friendly usage", () => {
  const actions = handleModerationCommand({
    commandKey: "hidetag",
    lower: "hidetag",
    cmd: "hidetag",
    ctx: {
      event: {
        waGroupId: "123@g.us",
        quotedWaMessageId: "msg-3",
        quotedMessageType: "locationMessage",
        quotedHasMedia: true
      }
    } as any,
    deps: buildDeps()
  });

  assert.equal(actions?.[0]?.kind, "reply_text");
  assert.match((actions?.[0] as { text: string }).text, /Tipo de mídia não suportado/i);
});
