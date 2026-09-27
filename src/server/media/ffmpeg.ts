// Voice notes to MP3 with FFmpeg, only when the transcription model rejects the original format ([MED-02]).
// The binary comes from ffmpeg-static (docs/plataforma-despliegue.md «Paquetes con binarios»); FFMPEG_BIN points
// elsewhere (a system FFmpeg in Docker). Every run has a hard time limit and works on temporary files it deletes.
import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { safeErrorMessage } from "@/server/redact";

/** A conversion that takes longer is stopped: the reply must not wait for it. */
export const FFMPEG_TIMEOUT_MS = 30_000;

export class MediaConversionError extends Error {
  constructor(readonly reason: "no_binary" | "timeout" | "failed") {
    super("No se ha podido convertir el audio.");
    this.name = "MediaConversionError";
  }
}

/** Converts audio bytes to MP3. Tests pass a fake one; the default runs FFmpeg. */
export type FfmpegRunner = (input: { bytes: Uint8Array; /** «.ogg»: helps FFmpeg read the input. */ extension: string; timeoutMs: number }) => Promise<Uint8Array>;

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

/** MP3, mono, 16 kHz, 64 kb/s: what speech needs, and small (about 0.5 MB per minute). */
export const convertToMp3WithFfmpeg: FfmpegRunner = async ({ bytes, extension, timeoutMs }) => {
  const binary = ffmpegBinaryPath();
  if (!binary) throw new MediaConversionError("no_binary");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dominia-audio-"));
  try {
    const input = path.join(dir, `input${/^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ""}`);
    const output = path.join(dir, "output.mp3");
    await fs.writeFile(input, bytes);
    await runProcess(
      binary,
      ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", input, "-vn", "-map_metadata", "-1", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "mp3", output],
      timeoutMs,
    );
    return new Uint8Array(await fs.readFile(output));
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch((error: unknown) => {
      // Only a temporary folder of the system: the conversion result is not affected.
      console.warn(`[media] No se ha podido borrar una carpeta temporal: ${safeErrorMessage(error)}`);
    });
  }
};
