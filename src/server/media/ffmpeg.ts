// Voice notes to MP3 with FFmpeg, only when the transcription model rejects the original format ([MED-02]).
// The binary comes from ffmpeg-static (docs/plataforma-despliegue.md «Paquetes con binarios»); FFMPEG_BIN points
// elsewhere (a system FFmpeg in Docker). Every run has a hard time limit and works on temporary files it deletes.
// The file comes from a customer ([SEG-13]): FFmpeg never guesses its format (-f is forced from the audio type its
// first bytes show, else its stored type, and only for the audio containers below: never a playlist or a «concat»
// script that would make it open other files or addresses) and may only open local files and pipes.
import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { safeErrorMessage } from "@/server/redact";
import { baseMimeType, detectAudioMimeType } from "./limits";

/** A conversion that takes longer is stopped: the reply must not wait for it. */
export const FFMPEG_TIMEOUT_MS = 30_000;

export class MediaConversionError extends Error {
  constructor(readonly reason: "no_binary" | "timeout" | "failed" | "unsupported") {
    super("No se ha podido convertir el audio.");
    this.name = "MediaConversionError";
  }
}

/** Converts audio bytes to MP3. Tests pass a fake one; the default runs FFmpeg. */
export type FfmpegRunner = (input: {
  bytes: Uint8Array;
  /** «.ogg»: only the temporary file's name; the input format is always forced (ffmpegInputFormat). */
  extension: string;
  /** The type stored with the file; its first bytes win when they show another audio type. */
  mimeType?: string | null;
  timeoutMs: number;
}) => Promise<Uint8Array>;

/** FFmpeg's demuxer for each audio type it may read ([MED-02]): nothing else is ever handed to it. */
const AUDIO_DEMUXERS: Readonly<Record<string, string>> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/webm": "matroska",
  "video/webm": "matroska",
  "audio/mp4": "mov",
  "audio/m4a": "mov",
  "audio/x-m4a": "mov",
  "video/mp4": "mov",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "audio/amr": "amr",
};

/** The input format (-f) for these bytes: from the audio type they show, else from the stored type; null = refuse. */
export function ffmpegInputFormat(bytes: Uint8Array, mimeType?: string | null): string | null {
  return AUDIO_DEMUXERS[detectAudioMimeType(bytes) ?? baseMimeType(mimeType)] ?? null;
}

/**
 * MP3, mono, 16 kHz, 64 kb/s: what speech needs, and small (about 0.5 MB per minute). The input format is forced and
 * only the file and pipe protocols are allowed, both before -i so they apply to the customer's file.
 */
export function ffmpegArguments(input: { path: string; format: string }, output: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-protocol_whitelist",
    "file,pipe",
    "-f",
    input.format,
    "-i",
    input.path,
    "-vn",
    "-map_metadata",
    "-1",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    "-f",
    "mp3",
    output,
  ];
}

/** FFMPEG_BIN when set, else the binary of ffmpeg-static; null on a platform it has no binary for. */
export function ffmpegBinaryPath(): string | null {
  return process.env.FFMPEG_BIN?.trim() || ffmpegStatic || null;
}

/** Runs a program without a shell and waits for it; after `timeoutMs` it is killed. Rejects unless it exits with 0. */
export function runProcess(binary: string, args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: "ignore", windowsHide: true });
    let timedOut = false;
    let failed = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", () => {
      // Missing binary or no permission: «close» may not follow.
      failed = true;
      clearTimeout(timer);
      reject(new MediaConversionError("failed"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (timedOut) reject(new MediaConversionError("timeout"));
      else if (code === 0) resolve();
      else reject(new MediaConversionError("failed"));
    });
  });
}

/** The audio as MP3 (ffmpegArguments). A file that is no audio FFmpeg may read is refused before it runs. */
export const convertToMp3WithFfmpeg: FfmpegRunner = async ({ bytes, extension, mimeType, timeoutMs }) => {
  const format = ffmpegInputFormat(bytes, mimeType);
  if (!format) throw new MediaConversionError("unsupported");
  const binary = ffmpegBinaryPath();
  if (!binary) throw new MediaConversionError("no_binary");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dominia-audio-"));
  try {
    const input = path.join(dir, `input${/^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ""}`);
    const output = path.join(dir, "output.mp3");
    await fs.writeFile(input, bytes);
    await runProcess(binary, ffmpegArguments({ path: input, format }, output), timeoutMs);
    return new Uint8Array(await fs.readFile(output));
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch((error: unknown) => {
      // Only a temporary folder of the system: the conversion result is not affected.
      console.warn(`[media] No se ha podido borrar una carpeta temporal: ${safeErrorMessage(error)}`);
    });
  }
};
