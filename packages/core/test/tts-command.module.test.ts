import { strict as assert } from "node:assert";
import test from "node:test";
import { handleTtsCommand } from "../src/modules/tts/presentation/commands/tts-commands.js";

test("tts command uses replied text when explicit text is missing", async () => {
  let synthesizedText = "";

  const actions = await handleTtsCommand({
    commandKey: "tts",
    cmd: "tts |en|female",
    ctx: {
      event: {
        quotedWaMessageId: "msg-tts-module-1",
        quotedText: "Texto grande vindo da mensagem respondida"
      }
    } as any,
    deps: {
      textToSpeech: {
        synthesize: async (input) => {
          synthesizedText = input.text;
          return {
            audioBase64: Buffer.from("audio").toString("base64"),
            mimeType: "audio/ogg"
          };
        }
      },
      config: {
        enabled: true,
        defaultSourceLanguage: "en",
        defaultLanguage: "en",
        defaultVoice: "female",
        maxTextChars: 700,
        sendAsPtt: true
      }
    }
  });

  assert.equal(synthesizedText, "Texto grande vindo da mensagem respondida");
  assert.equal(actions?.[0]?.kind, "reply_audio");
});
