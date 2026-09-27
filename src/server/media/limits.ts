// Sizes and file types of message media ([MED-01]–[MED-07], docs/security.md «Archivos»). Pure: the widget API,
// the simulator and the channel phases check the same limits before storing, and the model only gets what fits.
import "server-only";

const KB = 1024;
const MB = 1024 * KB;

/**
 * Largest file of each kind a customer may send by WhatsApp (docs/integracion-whatsapp-mensajes.md §10.3; above 100 MB
 * Meta itself refuses it, error 131052). A download stops as soon as it passes its kind's limit.
 */
export const INBOUND_MEDIA_CAPS = {
  audio: 16 * MB,
  image: 5 * MB,
  video: 16 * MB,
  /** Animated stickers, 500 KB (static ones, 100 KB). */
  sticker: 500 * KB,
  document: 100 * MB,
} as const;
export type InboundMediaKind = keyof typeof INBOUND_MEDIA_CAPS;

const isInboundMediaKind = (value: string): value is InboundMediaKind => Object.hasOwn(INBOUND_MEDIA_CAPS, value);

/** The kind of an inbound file: the message's own (audio, image…), else its type's family; anything else, a document. */
export function inboundMediaKind(contentType: string | null | undefined, mimeType?: string | null): InboundMediaKind {
  if (contentType && isInboundMediaKind(contentType)) return contentType;
  const family = baseMimeType(mimeType).split("/")[0];
  return family === "audio" || family === "image" || family === "video" ? family : "document";
}

export const MEDIA_LIMITS = {
  /** Largest file stored: WhatsApp delivers files up to 100 MB (docs/integracion-whatsapp-mensajes.md §10.3). */
  storedBytes: 100 * MB,
  /** Largest audio sent to transcription; above it the note is «No se pudo transcribir» ([MED-03]). */
  audioBytes: 25 * MB,
  /** Largest image sent to the model or described (WhatsApp's own image limit; every provider takes it). */
  imageBytes: 5 * MB,
  /** Largest PDF sent to the model as a file or read for its text ([MED-06]). */
  documentBytes: 10 * MB,
  /** Pages and characters of a PDF's text the model receives: enough to answer, bounded in cost. */
  documentPages: 50,
  documentChars: 20_000,
} as const;

export const OCTET_STREAM = "application/octet-stream";

// type/subtype, lower case, then optional `; name=value` parameters («audio/ogg; codecs=opus»).
const TOKEN = "[a-z0-9][a-z0-9!#$&^_.+-]{0,126}";
const BASE_MIME = new RegExp(`^${TOKEN}/${TOKEN}$`);
const FULL_MIME = new RegExp(`^${TOKEN}/${TOKEN}(?:\\s*;\\s*[a-z0-9-]{1,40}=(?:[a-z0-9._+-]{1,60}|"[a-z0-9._+ -]{1,60}"))*$`);

/** «audio/ogg» from «Audio/OGG; codecs=opus»; anything malformed is a generic binary. */
export function baseMimeType(raw: string | null | undefined): string {
  const base = (raw ?? "").split(";")[0].trim().toLowerCase();
  return BASE_MIME.test(base) ? base : OCTET_STREAM;
}

/** The type stored and served: lower case, parameters kept only when they are plain. */
export function storedMimeType(raw: string | null | undefined): string {
  const full = (raw ?? "").trim().toLowerCase();
  return full.length <= 200 && FULL_MIME.test(full) ? full : baseMimeType(raw);
}

const EXTENSIONS: Record<string, string> = {
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/flac": ".flac",
  "audio/amr": ".amr",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

/** Extension of the storage key: from the type, never from the customer's file name. Empty when unknown. */
export function extensionForMime(mimeType: string | null | undefined): string {
  return EXTENSIONS[baseMimeType(mimeType)] ?? "";
}

// Formats the transcription endpoint takes (docs/integracion-openrouter.md §5.1).
const TRANSCRIPTION_FORMATS: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
};

/** `input_audio.format` for this type, or null when it must be converted to MP3 first. */
export function transcriptionFormat(mimeType: string | null | undefined): string | null {
  return TRANSCRIPTION_FORMATS[baseMimeType(mimeType)] ?? null;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

// Audio containers by their first bytes (the declared type is not trusted). MPEG audio and ADTS AAC share the 12-bit
// frame sync; ADTS has layer 00, which MPEG audio never uses.
const AUDIO_SIGNATURES: { mimeType: string; matches: (bytes: Uint8Array) => boolean }[] = [
  { mimeType: "audio/ogg", matches: (b) => startsWith(b, ascii("OggS")) },
  { mimeType: "audio/webm", matches: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  { mimeType: "audio/mp4", matches: (b) => startsWith(b, ascii("ftyp"), 4) },
  { mimeType: "audio/wav", matches: (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WAVE"), 8) },
  { mimeType: "audio/flac", matches: (b) => startsWith(b, ascii("fLaC")) },
  { mimeType: "audio/amr", matches: (b) => startsWith(b, ascii("#!AMR")) },
  { mimeType: "audio/mpeg", matches: (b) => startsWith(b, ascii("ID3")) },
  { mimeType: "audio/aac", matches: (b) => b.length > 1 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0 },
  { mimeType: "audio/mpeg", matches: (b) => b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0 },
];

/** The audio type a file's first bytes show, or null when they are no audio container this app knows. */
export function detectAudioMimeType(bytes: Uint8Array): string | null {
  return AUDIO_SIGNATURES.find((signature) => signature.matches(bytes))?.mimeType ?? null;
}

// Image types a model accepts as `image_url` (docs/integracion-openrouter.md §3.2).
const MODEL_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function isModelImageType(mimeType: string | null | undefined): boolean {
  return MODEL_IMAGE_TYPES.has(baseMimeType(mimeType));
}

export function isPdf(mimeType: string | null | undefined, fileName?: string | null): boolean {
  return baseMimeType(mimeType) === "application/pdf" || /\.pdf$/i.test(fileName ?? "");
}
