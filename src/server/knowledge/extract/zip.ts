// Word (DOCX) and Excel (XLSX) files are ZIP archives, and their readers inflate every entry in memory. Before that,
// each entry is inflated here with a cap on its output, so a small file that unpacks to gigabytes (a «zip bomb») is
// refused instead of exhausting the server's memory ([SEG-13]; the file comes from outside). The sizes the archive
// declares are not trusted: the real output is what counts, and every declared size (central directory, local header
// and data descriptor) must be exactly the real one, because the XLSX reader streams the archive from its first byte
// and reserves each entry's memory by the size its local header declares. For the same reason the entries must follow
// one another from the start with nothing the central directory does not list. One entry (the document's properties)
// can also be read here, with its own cap.
import "server-only";
import { inflateRawSync } from "node:zlib";

/** Bytes an Office file may unpack to in total: a 25 MB document of text and images stays far below. */
export const MAX_ZIP_UNPACKED_BYTES = 100 * 1024 * 1024;
/** Entries an Office file may have. */
export const MAX_ZIP_ENTRIES = 10_000;

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const END_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const DESCRIPTOR_SIZE = 12;
const MAX_COMMENT = 0xffff;
const STORED = 0;
const DEFLATED = 8;
/** Flag bit 0: encrypted. Bit 3: the sizes and CRC follow the data (a data descriptor). */
const ENCRYPTED = 1;
const HAS_DESCRIPTOR = 8;

type ZipLimits = { maxUnpackedBytes: number; maxEntries: number };
/** An entry with its compressed data and the size it declares unpacked (the same in every header). */
type ZipEntry = { name: string; method: number; data: Uint8Array; size: number };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * The entries of a plain ZIP, with their compressed data; null when it is anything else (ZIP64, several disks,
 * encryption or another compression method are not used by Office files of this size), when its headers disagree
 * about a size, or when it holds anything but its listed entries one after another from the start. The caller
 * refuses it as unreadable.
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
  const disk = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const countOnDisk = view.getUint16(end + 8, true);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (disk !== 0 || centralDisk !== 0 || countOnDisk !== count) return null;
  if (count > maxEntries || centralOffset + centralSize !== end) return null;

  type Listed = { flags: number; method: number; compressedSize: number; size: number; nameBytes: Uint8Array; localOffset: number };
  const listed: Listed[] = [];
  let at = centralOffset;
  for (let n = 0; n < count; n += 1) {
    if (at + CENTRAL_SIZE > end || view.getUint32(at, true) !== CENTRAL_SIGNATURE) return null;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localOffset = view.getUint32(at + 42, true);
    if (at + CENTRAL_SIZE + nameLength > end) return null;
    const nameBytes = bytes.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength);
    at += CENTRAL_SIZE + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (flags & ENCRYPTED || (method !== STORED && method !== DEFLATED)) return null;
    if (method === STORED && compressedSize !== size) return null;
    listed.push({ flags, method, compressedSize, size, nameBytes, localOffset });
  }
  // The directory has nothing more than its entries.
  if (at !== end) return null;

  // In the order they are written (a directory may list them in another order).
  listed.sort((a, b) => a.localOffset - b.localOffset);
  const entries: ZipEntry[] = [];
  // Where the next entry's local header must start: the first at the start, each right after the one before.
  let nextLocal = 0;
  for (const { flags, method, compressedSize, size, nameBytes, localOffset } of listed) {
    if (localOffset !== nextLocal || localOffset + LOCAL_SIZE > centralOffset || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) return null;
    const localFlags = view.getUint16(localOffset + 6, true);
    const localCompressed = view.getUint32(localOffset + 18, true);
    const localSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    if (view.getUint16(localOffset + 8, true) !== method || (localFlags & HAS_DESCRIPTOR) !== (flags & HAS_DESCRIPTOR)) return null;
    if (!sameBytes(bytes.subarray(localOffset + LOCAL_SIZE, localOffset + LOCAL_SIZE + localNameLength), nameBytes)) return null;
    const descriptor = (flags & HAS_DESCRIPTOR) !== 0;
    // With a data descriptor the local header may say 0; otherwise it says exactly what the central directory does.
    const agrees = (value: number, expected: number) => value === expected || (descriptor && value === 0);
    if (!agrees(localCompressed, compressedSize) || !agrees(localSize, size)) return null;

    const dataStart = localOffset + LOCAL_SIZE + localNameLength + view.getUint16(localOffset + 28, true);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) return null;
    nextLocal = dataEnd;
    if (descriptor) {
      let sizes = dataEnd;
      if (sizes + 4 <= centralOffset && view.getUint32(sizes, true) === DESCRIPTOR_SIGNATURE) sizes += 4;
      if (sizes + DESCRIPTOR_SIZE > centralOffset) return null;
      if (view.getUint32(sizes + 4, true) !== compressedSize || view.getUint32(sizes + 8, true) !== size) return null;
      nextLocal = sizes + DESCRIPTOR_SIZE;
    }
    entries.push({ name: new TextDecoder().decode(nameBytes), method, data: bytes.subarray(dataStart, dataEnd), size });
  }
  // Every byte before the central directory belongs to a listed entry.
  if (nextLocal !== centralOffset) return null;
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

/** The entry unpacked when it is exactly the size it declares and no more than `maxBytes`; null otherwise. */
function unpackDeclared(entry: ZipEntry, maxBytes: number): Uint8Array | null {
  if (entry.size > maxBytes) return null;
  const unpacked = inflateEntry(entry, entry.size);
  return unpacked && unpacked.length === entry.size ? unpacked : null;
}

/** Whether the archive unpacks within the limits. False for anything that is not a plain ZIP. */
export function zipUnpacksWithinLimits(bytes: Uint8Array, limits: ZipLimits = { maxUnpackedBytes: MAX_ZIP_UNPACKED_BYTES, maxEntries: MAX_ZIP_ENTRIES }): boolean {
  const entries = zipEntries(bytes, limits.maxEntries);
  if (!entries) return false;
  let remaining = limits.maxUnpackedBytes;
  for (const entry of entries) {
    const unpacked = unpackDeclared(entry, remaining);
    if (!unpacked) return false;
    remaining -= unpacked.length;
  }
  return true;
}

/** One entry of the archive, unpacked, or null when it is missing, unreadable or bigger than `maxBytes`. */
export function readZipEntry(bytes: Uint8Array, name: string, maxBytes: number): Uint8Array | null {
  const entry = zipEntries(bytes, MAX_ZIP_ENTRIES)?.find((item) => item.name === name);
  return entry ? unpackDeclared(entry, maxBytes) : null;
}
