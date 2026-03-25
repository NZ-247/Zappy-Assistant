import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AudioPayloadProbe {
  byteLength: number;
  mimeType: string;
  container: "ogg" | "wav" | "mp3" | "mp4" | "webm" | "unknown";
  codecGuess: "opus" | "pcm" | "mp3" | "aac" | "vorbis" | "unknown";
}

export class AudioTranscodingError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

const normalizeMimeType = (value?: string): string => {
  const normalized = value?.trim().toLowerCase();
  return normalized || "application/octet-stream";
};

const detectContainer = (audioBuffer: Buffer, mimeType?: string): AudioPayloadProbe["container"] => {
  if (audioBuffer.length >= 4 && audioBuffer.subarray(0, 4).toString("ascii") === "OggS") return "ogg";
  if (audioBuffer.length >= 4 && audioBuffer.subarray(0, 4).toString("ascii") === "RIFF") return "wav";
  if (audioBuffer.length >= 3 && audioBuffer.subarray(0, 3).toString("ascii") === "ID3") return "mp3";
  if (audioBuffer.length >= 8 && audioBuffer.subarray(4, 8).toString("ascii") === "ftyp") return "mp4";
  if (audioBuffer.length >= 4 && audioBuffer[0] === 0x1a && audioBuffer[1] === 0x45 && audioBuffer[2] === 0xdf && audioBuffer[3] === 0xa3) {
    return "webm";
  }

  const mime = normalizeMimeType(mimeType);
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("aac")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "unknown";
};

const detectCodecGuess = (container: AudioPayloadProbe["container"], mimeType: string): AudioPayloadProbe["codecGuess"] => {
  if (mimeType.includes("codecs=opus")) return "opus";
  if (mimeType.includes("vorbis")) return "vorbis";
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "pcm";
  if (container === "ogg") return "vorbis";
  if (container === "wav") return "pcm";
  if (container === "mp3") return "mp3";
  if (container === "mp4") return "aac";
  return "unknown";
};

const extensionByContainer = (container: AudioPayloadProbe["container"]): string => {
  if (container === "ogg") return "ogg";
  if (container === "wav") return "wav";
  if (container === "mp3") return "mp3";
  if (container === "mp4") return "m4a";
  if (container === "webm") return "webm";
  return "bin";
};

const probeAudioPayload = (input: { audioBuffer: Buffer; mimeType?: string }): AudioPayloadProbe => {
  const mimeType = normalizeMimeType(input.mimeType);
  const container = detectContainer(input.audioBuffer, mimeType);
  const codecGuess = detectCodecGuess(container, mimeType);
  return {
    byteLength: input.audioBuffer.length,
    mimeType,
    container,
    codecGuess
  };
};

const runFfmpeg = async (args: string[], timeoutMs: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new AudioTranscodingError("ffmpeg_timeout"));
    }, timeoutMs);

    proc.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    proc.once("error", (error) => {
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new AudioTranscodingError("ffmpeg_not_found"));
        return;
      }
      reject(error);
    });

    proc.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      reject(new AudioTranscodingError(`ffmpeg_failed_${code ?? "unknown"}:${stderr || "no_stderr"}`));
    });
  });
};

const safeCleanupDir = async (path: string): Promise<void> => {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch {
    // noop
  }
};

export const transcodeToWhatsAppPtt = async (input: {
  audioBuffer: Buffer;
  mimeType?: string;
  timeoutMs?: number;
}): Promise<{
  audioBuffer: Buffer;
  mimeType: "audio/ogg; codecs=opus";
  container: "ogg";
  codec: "opus";
  transcoded: true;
  inputProbe: AudioPayloadProbe;
}> => {
  if (!input.audioBuffer.length) throw new AudioTranscodingError("empty_audio_payload");

  const inputProbe = probeAudioPayload(input);
  const tempDir = await fs.mkdtemp(join(tmpdir(), "zappy-ptt-"));
  const inputPath = join(tempDir, `input.${extensionByContainer(inputProbe.container)}`);
  const outputPath = join(tempDir, "output.ogg");
  const timeoutMs = input.timeoutMs ?? 20_000;

  try {
    await fs.writeFile(inputPath, input.audioBuffer);
    await runFfmpeg(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-vbr",
        "on",
        "-compression_level",
        "10",
        "-application",
        "voip",
        "-frame_duration",
        "20",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "ogg",
        outputPath
      ],
      timeoutMs
    );
    const output = await fs.readFile(outputPath);
    if (!output.length) throw new AudioTranscodingError("ffmpeg_empty_output");

    return {
      audioBuffer: output,
      mimeType: "audio/ogg; codecs=opus",
      container: "ogg",
      codec: "opus",
      transcoded: true,
      inputProbe
    };
  } finally {
    await safeCleanupDir(tempDir);
  }
};

export const inspectAudioPayload = probeAudioPayload;
