import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertToMp3WithFfmpeg, ffmpegBinaryPath, MediaConversionError, runProcess } from "./ffmpeg";

/** 0.3 s of silence as a 16 kHz mono 16-bit WAV. */
function silentWav(seconds = 0.3): Uint8Array {
  const rate = 16_000;
  const samples = Math.round(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return new Uint8Array(buffer);
}

afterEach(() => vi.unstubAllEnvs());

describe("FFmpeg for voice notes the model rejects [MED-02]", () => {
  it("the binary comes from ffmpeg-static, and FFMPEG_BIN overrides it", () => {
    vi.stubEnv("FFMPEG_BIN", "/usr/bin/ffmpeg");
    expect(ffmpegBinaryPath()).toBe("/usr/bin/ffmpeg");
    vi.stubEnv("FFMPEG_BIN", "");
    expect(ffmpegBinaryPath()).toMatch(/ffmpeg(\.exe)?$/);
  });

  it("a program that runs past its time limit is killed", async () => {
    const started = Date.now();
    await expect(runProcess(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], 300)).rejects.toMatchObject({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("a program that fails or does not exist is a conversion error", async () => {
    await expect(runProcess(process.execPath, ["-e", "process.exit(3)"], 5_000)).rejects.toMatchObject({ reason: "failed" });
    await expect(runProcess("/no/such/ffmpeg-binary", [], 5_000)).rejects.toBeInstanceOf(MediaConversionError);
  });

  it.skipIf(!fs.existsSync(ffmpegBinaryPath() ?? ""))("converts audio to MP3 with the bundled FFmpeg", async () => {
    const mp3 = await convertToMp3WithFfmpeg({ bytes: silentWav(), extension: ".wav", timeoutMs: 20_000 });
    expect(mp3.byteLength).toBeGreaterThan(100);
    // An MP3 starts with an ID3 tag or an MPEG frame sync.
    const header = Buffer.from(mp3.subarray(0, 3)).toString("latin1");
    expect(header === "ID3" || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0)).toBe(true);
  });

  it("without a binary, conversion fails cleanly", async () => {
    vi.stubEnv("FFMPEG_BIN", "/no/such/ffmpeg-binary");
    await expect(convertToMp3WithFfmpeg({ bytes: silentWav(), extension: ".wav", timeoutMs: 5_000 })).rejects.toBeInstanceOf(MediaConversionError);
  });
});
