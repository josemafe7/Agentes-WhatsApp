import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertToMp3WithFfmpeg, ffmpegArguments, ffmpegBinaryPath, ffmpegInputFormat, MediaConversionError, runProcess } from "./ffmpeg";
import { detectAudioMimeType } from "./limits";

const HAS_BINARY = fs.existsSync(ffmpegBinaryPath() ?? "");
const ascii = (text: string) => new TextEncoder().encode(text);

/** Whether `bytes` look like an MP3: an ID3 tag or an MPEG audio frame sync. */
function isMp3(bytes: Uint8Array): boolean {
  const header = Buffer.from(bytes.subarray(0, 3)).toString("latin1");
  return header === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

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

describe("FFmpeg only reads what it is told, from local files [MED-02] [SEG-13]", () => {
  it("the input format is always forced and only local files and pipes may be opened", () => {
    const args = ffmpegArguments({ path: "/tmp/x/input.ogg", format: "ogg" }, "/tmp/x/output.mp3");
    const input = args.indexOf("-i");
    expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("file,pipe");
    expect(args.indexOf("-protocol_whitelist")).toBeLessThan(input);
    // «-f ogg» right before «-i»: FFmpeg never guesses what a customer's file is.
    expect(args.slice(input - 2, input + 2)).toEqual(["-f", "ogg", "-i", "/tmp/x/input.ogg"]);
    expect(args.at(-1)).toBe("/tmp/x/output.mp3");
  });

  it("the format comes from the file's first bytes, then from its stored type; anything else is not converted", () => {
    expect(detectAudioMimeType(ascii("OggS\0\x02"))).toBe("audio/ogg");
    expect(detectAudioMimeType(silentWav())).toBe("audio/wav");
    expect(detectAudioMimeType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]))).toBe("audio/webm");
    expect(detectAudioMimeType(new Uint8Array([0, 0, 0, 0x20, ...ascii("ftypM4A ")]))).toBe("audio/mp4");
    expect(detectAudioMimeType(ascii("ID3\x04\0"))).toBe("audio/mpeg");
    expect(detectAudioMimeType(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe("audio/mpeg");
    expect(detectAudioMimeType(new Uint8Array([0xff, 0xf1, 0x50, 0x80]))).toBe("audio/aac");
    expect(detectAudioMimeType(ascii("fLaC\0"))).toBe("audio/flac");
    expect(detectAudioMimeType(ascii("#!AMR\n"))).toBe("audio/amr");
    expect(detectAudioMimeType(ascii("#EXTM3U\n"))).toBeNull();

    // The content wins over the stored type (a WAV stored as a voice note is still read as a WAV).
    expect(ffmpegInputFormat(silentWav(), "audio/ogg; codecs=opus")).toBe("wav");
    expect(ffmpegInputFormat(ascii("OggS\0\x02"), null)).toBe("ogg");
    expect(ffmpegInputFormat(new Uint8Array([0, 0, 0, 0x20, ...ascii("ftypisom")]), "video/mp4")).toBe("mov");
    // Unknown first bytes: the stored type, only if it is an audio FFmpeg is allowed to read.
    expect(ffmpegInputFormat(new Uint8Array([1, 2, 3, 4]), "audio/webm")).toBe("matroska");
    expect(ffmpegInputFormat(new Uint8Array([1, 2, 3, 4]), "text/plain")).toBeNull();
    expect(ffmpegInputFormat(ascii("#EXTM3U\nhttp://127.0.0.1/x.ts\n"), "application/vnd.apple.mpegurl")).toBeNull();
    expect(ffmpegInputFormat(ascii("ffconcat version 1.0\nfile '/etc/passwd'\n"), null)).toBeNull();
  });

  it("a file that is no audio FFmpeg may read is refused before FFmpeg runs", async () => {
    vi.stubEnv("FFMPEG_BIN", "/no/such/ffmpeg-binary");
    await expect(convertToMp3WithFfmpeg({ bytes: ascii("#EXTM3U\n"), extension: "", mimeType: "application/x-mpegurl", timeoutMs: 5_000 })).rejects.toMatchObject({
      reason: "unsupported",
    });
  });

  it.skipIf(!HAS_BINARY)("the real FFmpeg converts a tiny generated audio whose stored type is wrong: its content decides", async () => {
    const mp3 = await convertToMp3WithFfmpeg({ bytes: silentWav(0.2), extension: ".ogg", mimeType: "audio/ogg; codecs=opus", timeoutMs: 20_000 });
    expect(mp3.byteLength).toBeGreaterThan(100);
    expect(isMp3(mp3)).toBe(true);
    // And that MP3, stored as anything, is read again as an MP3.
    const again = await convertToMp3WithFfmpeg({ bytes: mp3, extension: "", mimeType: "application/octet-stream", timeoutMs: 20_000 });
    expect(isMp3(again)).toBe(true);
  });

  it.skipIf(!HAS_BINARY)("the real FFmpeg never opens an address a customer's file points to", async () => {
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests += 1;
      response.end("#EXTM3U\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const playlist = ascii(`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${port}/segmento.ts\n#EXT-X-ENDLIST\n`);
      // Stored as a voice note: FFmpeg is told it is an MP3, so it never reads it as a playlist.
      await expect(convertToMp3WithFfmpeg({ bytes: playlist, extension: ".mp3", mimeType: "audio/mpeg", timeoutMs: 20_000 })).rejects.toBeInstanceOf(MediaConversionError);
      // Even with the format left to FFmpeg (it would read it as a playlist), the whitelist keeps it off the network.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-ffmpeg-test-"));
      try {
        const list = path.join(dir, "lista.m3u8");
        fs.writeFileSync(list, playlist);
        const guessing = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-protocol_whitelist", "file,pipe", "-i", list, "-f", "mp3", path.join(dir, "salida.mp3")];
        await expect(runProcess(ffmpegBinaryPath() ?? "", guessing, 20_000)).rejects.toBeInstanceOf(MediaConversionError);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
