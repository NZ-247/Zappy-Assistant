import { strict as assert } from "node:assert";
import test from "node:test";
import { createCommandRegistry } from "../src/commands/registry/index.js";
import { handleAudioCommand } from "../src/modules/tools/audio/presentation/commands/audio-commands.js";

test("registry resolves /tss to transcribe command", () => {
  const registry = createCommandRegistry("/");
  const resolved = registry.resolve("/tss");
  assert.ok(resolved);
  assert.equal(resolved?.command.name, "transcribe");
});

test("audio command transcribes replied audio", () => {
  const actions = handleAudioCommand({
    commandKey: "transcribe",
    ctx: {
      event: {
        rawMessageType: "extendedTextMessage",
        quotedWaMessageId: "msg-audio-1",
        quotedMessageType: "audioMessage"
      }
    } as any,
    deps: {
      config: {
        capabilityEnabled: true,
        autoTranscribeInboundAudio: true,
        allowDynamicCommandDispatch: true,
        commandPrefix: "/"
      }
    }
  });

  assert.ok(actions);
  assert.equal(actions?.[0]?.kind, "audio_transcription");
  assert.equal((actions?.[0] as { source?: string }).source, "quoted");
});
