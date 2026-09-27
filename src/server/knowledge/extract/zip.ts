// Word (DOCX) and Excel (XLSX) files are ZIP archives, and their readers inflate every entry in memory. Before that,
// each entry is inflated here with a cap on its output, so a small file that unpacks to gigabytes (a «zip bomb») is
// refused instead of exhausting the server's memory ([SEG-13]; the file comes from outside). The sizes the archive
// declares are not trusted: the real output is what counts. One entry (the document's properties) can also be read
// here, with its own cap.
import "server-only";
import { inflateRawSync } from "node:zlib";

/** Bytes an Office file may unpack to in total: a 25 MB document of text and images stays far below. */
export const MAX_ZIP_UNPACKED_BYTES = 100 * 1024 * 1024;
/** Entries an Office file may have. */
export const MAX_ZIP_ENTRIES = 10_000;

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;
const STORED = 0;
const DEFLATED = 8;

type ZipLimits = { maxUnpackedBytes: number; maxEntries: number };
type ZipEntry = { name: string; method: number; data: Uint8Array };

/**
 * The entries of a plain ZIP, with their compressed data; null when it is anything else (ZIP64, encryption or another
 * compression method are not used by Office files of this size), so the caller refuses it as unreadable.
 */
function zipEntries(bytes: Uint8Array, maxEntries: number): ZipEntry[] | null {
  if (bytes.length < END_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - END_SIZE; at >= Math.max(0, bytes.length - END_SIZE - MAX_COMMENT); at -= 1) {
    if (view.getUint32(at, true) === END_SIGNATURE) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (count > maxEntries || centralOffset >= end) return null;

  const entries: ZipEntry[] = [];
  let at = centralOffset;
  for (let n = 0; n < count; n += 1) {
    if (at + CENTRAL_SIZE > end || view.getUint32(at, true) !== CENTRAL_SIGNATURE) return null;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const localOffset = view.getUint32(at + 42, true);
    if (at + CENTRAL_SIZE + nameLength > end) return null;
    const name = new TextDecoder().decode(bytes.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength));
    at += CENTRAL_SIZE + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    // Bit 0: encrypted.
    if (flags & 1 || (method !== STORED && method !== DEFLATED)) return null;
    if (localOffset + LOCAL_SIZE > end || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) return null;
    const dataStart = localOffset + LOCAL_SIZE + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > end) return null;
    entries.push({ name, method, data: bytes.subarray(dataStart, dataStart + compressedSize) });
  }
  return entries;
}

/** The entry's real bytes, or null when they would pass `maxBytes` (Node stops inflating there, never beyond). */
function inflateEntry(entry: ZipEntry, maxBytes: number): Uint8Array | null {
  if (entry.method === STORED) return entry.data.length <= maxBytes ? entry.data : null;
  try {
    // One byte more than allowed: reaching it means the entry is too big.
    const unpacked = inflateRawSync(entry.data, { maxOutputLength: maxBytes + 1 });
    return unpacked.length <= maxBytes ? new Uint8Array(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength) : null;
  } catch {
    return null;
  }
}

/** Whether the archive unpacks within the limits. False for anything that is not a plain ZIP. */
export function zipUnpacksWithinLimits(bytes: Uint8Array, limits: ZipLimits = { maxUnpackedBytes: MAX_ZIP_UNPACKED_BYTES, maxEntries: MAX_ZIP_ENTRIES }): boolean {
  const entries = zipEntries(bytes, limits.maxEntries);
  if (!entries) return false;
  let remaining = limits.maxUnpackedBytes;
  for (const entry of entries) {
    const unpacked = inflateEntry(entry, remaining);
    if (!unpacked) return false;
    remaining -= unpacked.length;
  }
  return true;
}

/** One entry of the archive, unpacked, or null when it is missing, unreadable or bigger than `maxBytes`. */
export function readZipEntry(bytes: Uint8Array, name: string, maxBytes: number): Uint8Array | null {
  const entry = zipEntries(bytes, MAX_ZIP_ENTRIES)?.find((item) => item.name === name);
  return entry ? inflateEntry(entry, maxBytes) : null;
}
