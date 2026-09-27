// Sizes and file types of message media ([MED-01]–[MED-07], docs/security.md «Archivos»). Pure: the widget API,
// the simulator and the channel phases check the same limits before storing, and the model only gets what fits.

const MB = 1024 * 1024;

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

// Image types a model accepts as `image_url` (docs/integracion-openrouter.md §3.2).
const MODEL_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function isModelImageType(mimeType: string | null | undefined): boolean {
  return MODEL_IMAGE_TYPES.has(baseMimeType(mimeType));
}

export function isPdf(mimeType: string | null | undefined, fileName?: string | null): boolean {
  return baseMimeType(mimeType) === "application/pdf" || /\.pdf$/i.test(fileName ?? "");
}
