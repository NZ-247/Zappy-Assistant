import { strict as assert } from "node:assert";
import test from "node:test";
import { inspectAudioPayload } from "../src/infrastructure/outbound/handlers/wa-audio-transcoding.js";
import {
  normalizeAssistantAudioToVoiceNote,
  VoiceNoteNormalizationError,
  WHATSAPP_VOICE_NOTE_MIME_TYPE
} from "../src/infrastructure/outbound/handlers/wa-audio-send-pipeline.js";

test("normalizeAssistantAudioToVoiceNote normalizes mismatched input format through canonical pipeline", async () => {
  const inputAudio = Buffer.from("ID3not-really-mp3-but-good-enough-for-probe", "utf-8");
  const transcodedAudio = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(320, 7)]);

  const normalized = await normalizeAssistantAudioToVoiceNote({
    audioBuffer: inputAudio,
    mimeType: "audio/mpeg",
    sourceFlow: "tts",
    transcodeFn: async ({ audioBuffer, mimeType }) => ({
      audioBuffer: transcodedAudio,
      mimeType: WHATSAPP_VOICE_NOTE_MIME_TYPE,
      container: "ogg",
      codec: "opus",
      transcoded: true,
      inputProbe: inspectAudioPayload({
        audioBuffer,
        mimeType
      })
    })
  });

  assert.equal(normalized.ptt, true);
  assert.equal(normalized.mimeType, WHATSAPP_VOICE_NOTE_MIME_TYPE);
  assert.equal(normalized.diagnostics.transcoded, true);
  assert.equal(normalized.diagnostics.inputProbe.container, "mp3");
  assert.equal(normalized.diagnostics.outputProbe.container, "ogg");
  assert.equal(normalized.diagnostics.outputProbe.codecGuess, "opus");
});

test("normalizeAssistantAudioToVoiceNote throws explicit error when normalization fails", async () => {
  await assert.rejects(
    () =>
      normalizeAssistantAudioToVoiceNote({
        audioBuffer: Buffer.from([1, 2, 3, 4]),
        mimeType: "audio/mpeg",
        sourceFlow: "download",
        transcodeFn: async () => {
          throw new Error("transcode_failed_for_test");
        }
      }),
    (error: unknown) =>
      error instanceof VoiceNoteNormalizationError &&
      error.reason === "transcode_failed_for_test" &&
      error.diagnostics.sourceFlow === "download"
  );
});
