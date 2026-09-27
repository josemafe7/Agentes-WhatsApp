// FileStorage: private files (media, documents, logos) behind one interface (docs/decisions/0010).
// Disk (data/uploads) locally and on a VPS; a private Supabase Storage bucket when SUPABASE_URL and
// SUPABASE_SECRET_KEY are set. Files are never public: /api/files/… checks permissions and streams them.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createClient, StorageApiError } from "@supabase/supabase-js";

export type StoredFile = { stream: ReadableStream<Uint8Array>; contentType: string; size: number };

export interface FileStorage {
  readonly kind: "disk" | "supabase";
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

/** This installation's bucket in Supabase Storage. Always private; created on the first upload if it is missing. */
export const SUPABASE_BUCKET = "dominia-archivos";

export type SupabaseStorageConfig = {
  /** Project URL: https://<ref>.supabase.co. */
  url: string;
  /** Secret key (sb_secret_…). It bypasses Row Level Security: server only, never in a NEXT_PUBLIC_ variable. */
  secretKey: string;
  /** Only tests pass one (a fake Storage API); the app uses the global fetch. */
  fetch?: typeof fetch;
};

// Storage answers a missing object or bucket with HTTP 404, or (as it long has) HTTP 400 with "404" in the body;
// a bucket that already exists, with 409 or 400 + "409" (https://supabase.com/docs/guides/storage/debugging/error-codes).
const NOT_FOUND = { status: 404, codes: new Set(["NoSuchKey", "NoSuchBucket"]) };
const ALREADY_EXISTS = { status: 409, codes: new Set(["BucketAlreadyExists", "ResourceAlreadyExists"]) };

function storageErrorIs(error: unknown, expected: { status: number; codes: ReadonlySet<string> }): boolean {
  if (!(error instanceof StorageApiError)) return false;
  return error.status === expected.status || error.statusCode === String(expected.status) || expected.codes.has(error.code ?? "");
}

/** Private Supabase Storage bucket, used only from the server with the secret key. */
export class SupabaseStorage implements FileStorage {
  readonly kind = "supabase";
  private client: ReturnType<typeof createClient> | undefined;
  private bucketReady: Promise<void> | undefined;

  constructor(private readonly config: SupabaseStorageConfig) {}

  async put(key: string, data: Uint8Array, contentType: string): Promise<{ key: string; size: number }> {
    assertValidKey(key);
    await this.ensureBucket();
    // upsert: the same key is overwritten, as on disk.
    const { error } = await this.bucket().upload(key, data, { contentType: contentType || FALLBACK_CONTENT_TYPE, upsert: true });
    if (error) throw error;
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<StoredFile | null> {
    assertValidKey(key);
    // The whole file as a Blob, with its type and exact size (the route sends Content-Length); never from a cache.
    const { data, error } = await this.bucket().download(key, {}, { cache: "no-store" });
    if (error) {
      if (storageErrorIs(error, NOT_FOUND)) return null;
      throw error;
    }
    return { stream: data.stream(), contentType: data.type || FALLBACK_CONTENT_TYPE, size: data.size };
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    const { error } = await this.bucket().remove([key]);
    // Nothing to delete (no such file, or no bucket yet) is fine, as on disk.
    if (error && !storageErrorIs(error, NOT_FOUND)) throw error;
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    // The SDK answers false for a missing file (HTTP 400 or 404) and throws any other failure.
    const { data } = await this.bucket().exists(key);
    return data;
  }

  /** The Supabase client, created on first use. No user session: every request carries the secret key in its headers. */
  private storage() {
    this.client ??= createClient(this.config.url, this.config.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...(this.config.fetch && { global: { fetch: this.config.fetch } }),
    });
    return this.client.storage;
  }

  private bucket() {
    return this.storage().from(SUPABASE_BUCKET);
  }

  /** Once per process, before the first upload. A failure is tried again on the next upload. */
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= this.createBucketIfMissing().catch((error: unknown) => {
      this.bucketReady = undefined;
      throw error;
    });
    return this.bucketReady;
  }

  private async createBucketIfMissing(): Promise<void> {
    const existing = await this.storage().getBucket(SUPABASE_BUCKET);
    if (existing.data) {
      // Files must never be reachable by URL ([MED-08]): a public bucket is not used.
      if (existing.data.public) {
        throw new Error(`El bucket «${SUPABASE_BUCKET}» de Supabase Storage es público: los archivos se podrían abrir sin permiso. Hazlo privado en Supabase (Storage) y vuelve a intentarlo.`);
      }
      return;
    }
    if (!storageErrorIs(existing.error, NOT_FOUND)) throw existing.error;
    const created = await this.storage().createBucket(SUPABASE_BUCKET, { public: false });
    // Another server or request created it meanwhile: it exists, which is all this needs.
    if (created.error && !storageErrorIs(created.error, ALREADY_EXISTS)) throw created.error;
  }
}

export const DISK_STORAGE_DIR = path.join(process.cwd(), "data", "uploads");

type Env = Readonly<Record<string, string | undefined>>;

/** Supabase Storage settings, only when both variables are set. */
export function supabaseStorageConfig(env: Env = process.env): SupabaseStorageConfig | null {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  return url && secretKey ? { url, secretKey } : null;
}

export function isSupabaseStorageConfigured(env: Env = process.env): boolean {
  return supabaseStorageConfig(env) !== null;
}

/**
 * Supabase Storage when SUPABASE_URL and SUPABASE_SECRET_KEY are set, otherwise the disk. On Vercel the disk does not
 * keep files, so there it is an error.
 */
export function createFileStorage(env: Env = process.env): FileStorage {
  const config = supabaseStorageConfig(env);
  if (config) return new SupabaseStorage(config);
  if (env.VERCEL) {
    throw new Error(
      "Faltan SUPABASE_URL y SUPABASE_SECRET_KEY: en Vercel los archivos se guardan en Supabase Storage, porque el disco no los conserva. Ponlas en las variables de entorno del proyecto (la secret key, como Sensitive) y vuelve a desplegar.",
    );
  }
  return new DiskStorage(DISK_STORAGE_DIR);
}

let shared: FileStorage | undefined;

export function getFileStorage(): FileStorage {
  shared ??= createFileStorage();
  return shared;
}
