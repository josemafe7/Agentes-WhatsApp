// Media files of the demo ([ARR-08]) and the simulator's sample files ([AJU-12]), made in code (wav.ts, png.ts,
// pdf.ts): the repository holds no binaries. The seed stores the demo's voice note and its sector's picture under
// fixed keys, so loading the demo again overwrites them instead of leaving copies behind.
import "server-only";
import type { Sector } from "@/lib/enums";
import { getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { simplePdf } from "./pdf";
import { sectorImagePng } from "./png";
import { voiceNoteWav } from "./wav";

export type DemoFile = { fileKey: string; mimeType: string; fileName: string; bytes: Uint8Array };
export type SampleFile = Omit<DemoFile, "fileKey">;

/** Length of the demo's voice note, about as long as its transcript takes to say. */
export const DEMO_VOICE_NOTE_SECONDS = 9;
const SAMPLE_VOICE_NOTE_SECONDS = 4;

/** The voice note and the picture the customers send in the sector's demo conversations. */
export function demoMediaFiles(sector: Sector): { voiceNote: DemoFile; image: DemoFile } {
  return {
    voiceNote: { fileKey: "demo/nota-de-voz.wav", mimeType: "audio/wav", fileName: "nota-de-voz.wav", bytes: voiceNoteWav({ seconds: DEMO_VOICE_NOTE_SECONDS }) },
    image: { fileKey: `demo/imagen-${sector}.png`, mimeType: "image/png", fileName: "foto.png", bytes: sectorImagePng(sector) },
  };
}

/**
 * Where the seed stores the demo files. Vitest runs never write into the project's data/uploads (docs/testing.md):
 * there the demo's messages point at the fixed keys and the files are simply not written.
 */
export function demoMediaStorage(): FileStorage | null {
  return process.env.VITEST ? null : getFileStorage();
}

export async function writeDemoMedia(files: readonly DemoFile[], storage: FileStorage | null = demoMediaStorage()): Promise<void> {
  if (!storage) return;
  for (const file of files) await storage.put(file.fileKey, file.bytes, file.mimeType);
}

export const SAMPLE_KINDS = ["audio", "image", "document"] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

/** The simulator's ready-made files: a voice note (a murmur, not speech), the sector's picture and a one-page PDF. */
export function simulatorSample(kind: SampleKind, context: { sector: Sector; businessName: string }): SampleFile {
  if (kind === "audio") {
    return { mimeType: "audio/wav", fileName: "nota-de-voz.wav", bytes: voiceNoteWav({ seconds: SAMPLE_VOICE_NOTE_SECONDS, seed: 7 }) };
  }
  if (kind === "image") return { mimeType: "image/png", fileName: "foto.png", bytes: sectorImagePng(context.sector) };
  return {
    mimeType: "application/pdf",
    fileName: "documento-de-ejemplo.pdf",
    bytes: simplePdf({
      title: "Documento de ejemplo",
      lines: [
        `Para: ${context.businessName}`,
        "",
        "Este PDF lo ha enviado el simulador de canales de DominIA Agentes",
        "para probar cómo llegan los documentos a la bandeja.",
        "",
        "Referencia: SIM-0001",
      ],
    }),
  };
}
