// FileStorage: private files (media, documents, logos) behind one interface (docs/decisions/0010).
// Disk (data/uploads) locally and on a VPS; a private Vercel Blob store when BLOB_STORE_ID or
// BLOB_READ_WRITE_TOKEN is set. Files are never public: /api/files/… checks permissions and streams them.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";

export type StoredFile = { stream: ReadableStream<Uint8Array>; contentType: string; size: number };

export interface FileStorage {
  readonly kind: "disk" | "vercel-blob";
  /** Keys come from generateFileKey(): never a user-supplied file name. */
  put(key: string, data: Uint8Array, contentType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const FALLBACK_CONTENT_TYPE = "application/octet-stream";
const SEGMENT = "[a-z0-9][a-z0-9_-]{0,63}";
// prefix/…/name(.ext): lower-case segments, one optional short extension on the last one.
const KEY_PATTERN = new RegExp(`^${SEGMENT}(?:/${SEGMENT}){0,5}(?:\\.[a-z0-9]{1,10})?$`);
const EXTENSION_PATTERN = /\.([a-z0-9]{1,10})$/;

export class InvalidFileKeyError extends Error {
  constructor() {
    super("Clave de archivo no válida.");
    this.name = "InvalidFileKeyError";
  }
}

export function isValidFileKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

function assertValidKey(key: string): void {
  if (!isValidFileKey(key)) throw new InvalidFileKeyError();
}

/** Lower-case extension of a file name, only if it is short and plain ("Factura.PDF" → ".pdf"). */
export function safeExtension(fileName: string | null | undefined): string {
  const match = fileName?.toLowerCase().match(EXTENSION_PATTERN);
  return match ? `.${match[1]}` : "";
}

/** New random key: `<prefix>/<yyyy>/<mm>/<uuid><ext>`. The original name is kept (if at all) in the database. */
export function generateFileKey(prefix: string, extension = "", now = new Date()): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const key = `${prefix}/${year}/${month}/${crypto.randomUUID()}${extension.toLowerCase()}`;
  assertValidKey(key);
  return key;
}

/** Reads a stream fully (for AI calls that need the bytes). */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type DiskMeta = { contentType: string; size: number };

async function statIfExists(file: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export class DiskStorage implements FileStorage {
  readonly kind = "disk";
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** Absolute path of a key, guaranteed to stay inside the root folder. */
  private resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, ...key.split("/"));
    const relative = path.relative(this.root, full);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new InvalidFileKeyError();
    return full;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<{ key: string; size: number }> {
    const full = this.resolve(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    const meta: DiskMeta = { contentType: contentType || FALLBACK_CONTENT_TYPE, size: data.byteLength };
    // Write to a temporary name and rename, so a reader never sees half a file.
    const temporary = `${full}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, data);
    await fs.promises.rename(temporary, full);
    await fs.promises.writeFile(`${full}.meta.json`, JSON.stringify(meta));
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<StoredFile | null> {
    const full = this.resolve(key);
    const stat = await statIfExists(full);
    if (!stat?.isFile()) return null;
    const meta = await this.readMeta(full);
    const stream = Readable.toWeb(fs.createReadStream(full)) as unknown as ReadableStream<Uint8Array>;
    return { stream, contentType: meta?.contentType ?? FALLBACK_CONTENT_TYPE, size: stat.size };
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    await fs.promises.rm(full, { force: true });
    await fs.promises.rm(`${full}.meta.json`, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const stat = await statIfExists(this.resolve(key));
    return stat?.isFile() ?? false;
  }

  private async readMeta(full: string): Promise<DiskMeta | null> {
    try {
      return JSON.parse(await fs.promises.readFile(`${full}.meta.json`, "utf8")) as DiskMeta;
    } catch {
      // Missing or damaged metadata: the file is still served, as a generic binary.
      return null;
    }
  }
}

/** Private Vercel Blob store (@vercel/blob ≥ 2.3). The SDK takes OIDC + BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN. */
export class VercelBlobStorage implements FileStorage {
  readonly kind = "vercel-blob";

  async put(key: string, data: Uint8Array, contentType: string): Promise<{ key: string; size: number }> {
    assertValidKey(key);
    await put(key, Buffer.from(data), {
      access: "private",
      contentType: contentType || FALLBACK_CONTENT_TYPE,
      addRandomSuffix: false,
    });
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<StoredFile | null> {
    assertValidKey(key);
    const result = await get(key, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { stream: result.stream, contentType: result.blob.contentType || FALLBACK_CONTENT_TYPE, size: result.blob.size };
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await del(key);
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    try {
      await head(key);
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      throw error;
    }
  }
}

export const DISK_STORAGE_DIR = path.join(process.cwd(), "data", "uploads");

export function isBlobStorageConfigured(): boolean {
  return Boolean(process.env.BLOB_STORE_ID?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

let shared: FileStorage | undefined;

/** Vercel Blob when its credentials exist (decision 0010), otherwise the disk. */
export function getFileStorage(): FileStorage {
  shared ??= isBlobStorageConfigured() ? new VercelBlobStorage() : new DiskStorage(DISK_STORAGE_DIR);
  return shared;
}
