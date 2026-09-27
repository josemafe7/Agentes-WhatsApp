import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createFileStorage,
  DiskStorage,
  generateFileKey,
  InvalidFileKeyError,
  isSupabaseStorageConfigured,
  isValidFileKey,
  readAll,
  safeExtension,
  SUPABASE_BUCKET,
  SupabaseStorage,
} from "./file-storage";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-files-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const bytes = (text: string) => new TextEncoder().encode(text);

describe("file keys [SEG-13]", () => {
  it("generates random keys that never contain the original name", () => {
    const key = generateFileKey("media", safeExtension("Factura Ñoña.PDF"), new Date("2026-09-26T10:00:00Z"));
    expect(key).toMatch(/^media\/2026\/09\/[0-9a-f-]{36}\.pdf$/);
    expect(generateFileKey("media")).not.toBe(generateFileKey("media"));
  });

  it("accepts only plain keys", () => {
    for (const bad of ["../x", "a/../../b", "/abs", "C:/x", "a\\b", "a//b", "a/b.meta.json", "Mayus/x", "a/.env", ""]) {
      expect(isValidFileKey(bad), bad).toBe(false);
    }
    expect(isValidFileKey("kb/2026/09/abc-123.pdf")).toBe(true);
  });

  it("extracts only short plain extensions", () => {
    expect(safeExtension("foto.JPG")).toBe(".jpg");
    expect(safeExtension("sin-extension")).toBe("");
    expect(safeExtension("raro.ext;rm")).toBe("");
  });
});

describe("DiskStorage", () => {
  const storage = new DiskStorage(root);

  it("stores, reads, checks and deletes a file with its content type", async () => {
    const key = generateFileKey("test", ".txt");
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.put(key, bytes("hola"), "text/plain")).toEqual({ key, size: 4 });
    expect(await storage.exists(key)).toBe(true);
    const file = await storage.get(key);
    expect(file).not.toBeNull();
    expect(file?.contentType).toBe("text/plain");
    expect(file?.size).toBe(4);
    expect(new TextDecoder().decode(await readAll(file!.stream))).toBe("hola");
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it("never reads or writes outside its folder", async () => {
    await expect(storage.put("../escape.txt", bytes("x"), "text/plain")).rejects.toThrow(InvalidFileKeyError);
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(InvalidFileKeyError);
    expect(fs.existsSync(path.join(path.dirname(root), "escape.txt"))).toBe(false);
  });
});

// Supabase Storage, against an in-memory copy of the Storage API endpoints the SDK calls: no network.
const SUPABASE_URL = "https://proyecto-de-prueba.supabase.co";
// Put together at runtime so secret scanners never mistake it for a real Supabase key.
const SECRET_KEY = ["sb", "secret", "solo-para-las-pruebas"].join("_");
const BUCKET_PATH = `/storage/v1/bucket/${SUPABASE_BUCKET}`;
const OBJECTS_PATH = `/storage/v1/object/${SUPABASE_BUCKET}`;
/** The only endpoints it may call: the bucket and its objects, never public or signed URLs. */
const PRIVATE_ENDPOINTS = new RegExp(`^(/storage/v1/bucket|${BUCKET_PATH}|${OBJECTS_PATH}(/[a-z0-9/._-]+)?)$`);
const KEY = "media/2026/09/foto.png";

type ApiRequest = { method: string; path: string; url: string; headers: Headers; body: unknown; cache: RequestCache | undefined };

const json = (body: unknown, status = 200) => Response.json(body, { status });
// Supabase's own answers: HTTP 400 with the real status in the body, as Storage has long answered these.
const objectNotFound = () => json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);
const bucketNotFound = () => json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 400);
const alreadyExists = (code?: string) => json({ statusCode: "409", error: "Duplicate", message: "The resource already exists", code }, 400);
/** A failure with its status: HEAD answers carry no body. */
const failure = (status: number, message: string) => (request: ApiRequest) =>
  request.method === "HEAD" ? new Response(null, { status }) : json({ statusCode: String(status), error: "Error", message }, status);

/** The Storage API as Supabase answers it, in memory. `answer` takes over the requests it returns a response for. */
function fakeStorageApi(start: { bucket?: { public: boolean } } = {}) {
  const api = {
    bucket: start.bucket ?? (null as { public: boolean } | null),
    objects: new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>(),
    requests: [] as ApiRequest[],
    answer: undefined as ((request: ApiRequest) => Response | undefined | Promise<Response | undefined>) | undefined,
    fetch: (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : init.body instanceof Uint8Array ? new Uint8Array(init.body) : init.body;
      const request: ApiRequest = { method: init.method ?? "GET", path: url.pathname, url: url.href, headers: new Headers(init.headers), body, cache: init.cache };
      api.requests.push(request);
      return (await api.answer?.(request)) ?? storageAnswer(request);
    }) as typeof fetch,
  };

  function storageAnswer({ method, path: requestPath, headers, body }: ApiRequest): Response {
    if (method === "GET" && requestPath === BUCKET_PATH) {
      if (!api.bucket) return bucketNotFound();
      return json({ id: SUPABASE_BUCKET, name: SUPABASE_BUCKET, owner: "", public: api.bucket.public, created_at: "2026-09-27T10:00:00Z", updated_at: "2026-09-27T10:00:00Z" });
    }
    if (method === "POST" && requestPath === "/storage/v1/bucket") {
      if (api.bucket) return alreadyExists("BucketAlreadyExists");
      const created = body as { name: string; public: boolean };
      api.bucket = { public: created.public };
      return json({ name: created.name });
    }
    if (method === "DELETE" && requestPath === OBJECTS_PATH) {
      if (!api.bucket) return bucketNotFound();
      const deleted = (body as { prefixes: string[] }).prefixes.filter((key) => api.objects.delete(key));
      return json(deleted.map((name) => ({ name, bucket_id: SUPABASE_BUCKET })));
    }
    if (requestPath.startsWith(`${OBJECTS_PATH}/`)) {
      const key = requestPath.slice(OBJECTS_PATH.length + 1);
      const object = api.objects.get(key);
      if (method === "POST") {
        if (!api.bucket) return bucketNotFound();
        if (object && headers.get("x-upsert") !== "true") return alreadyExists();
        api.objects.set(key, { bytes: body as Uint8Array<ArrayBuffer>, contentType: headers.get("content-type") ?? "" });
        return json({ Id: crypto.randomUUID(), Key: `${SUPABASE_BUCKET}/${key}` });
      }
      if (method === "GET") return object ? new Response(object.bytes, { headers: { "content-type": object.contentType } }) : objectNotFound();
      if (method === "HEAD") return new Response(null, { status: object ? 200 : 400 });
    }
    return json({ statusCode: "400", error: "InvalidRequest", message: `Sin simular: ${method} ${requestPath}` }, 400);
  }

  return api;
}

type FakeStorageApi = ReturnType<typeof fakeStorageApi>;

const supabaseStorage = (api: FakeStorageApi) => new SupabaseStorage({ url: SUPABASE_URL, secretKey: SECRET_KEY, fetch: api.fetch });
const calls = (api: FakeStorageApi) => api.requests.map((request) => `${request.method} ${request.path}`);

describe("SupabaseStorage [MED-08]", () => {
  it("creates the private bucket on the first upload and uploads with upsert, the secret key only in the headers", async () => {
    const api = fakeStorageApi();
    const storage = supabaseStorage(api);
    expect(api.requests).toHaveLength(0);

    expect(await storage.put(KEY, bytes("png"), "image/png")).toEqual({ key: KEY, size: 3 });
    expect(calls(api)).toEqual([`GET ${BUCKET_PATH}`, "POST /storage/v1/bucket", `POST ${OBJECTS_PATH}/${KEY}`]);
    expect(api.requests[1].body).toMatchObject({ id: SUPABASE_BUCKET, name: SUPABASE_BUCKET, public: false });
    expect(api.bucket).toEqual({ public: false });
    const upload = api.requests[2];
    expect(upload.headers.get("x-upsert")).toBe("true");
    expect(upload.headers.get("content-type")).toBe("image/png");
    expect(api.objects.get(KEY)?.bytes).toEqual(bytes("png"));
    for (const request of api.requests) {
      expect(request.headers.get("apikey")).toBe(SECRET_KEY);
      expect(request.url).not.toContain(SECRET_KEY);
    }
  });

  it("stores, reads, checks and deletes a file with its content type, only through the private endpoints", async () => {
    const api = fakeStorageApi({ bucket: { public: false } });
    const storage = supabaseStorage(api);
    expect(await storage.exists(KEY)).toBe(false);
    await storage.put(KEY, bytes("hola"), "text/plain");
    expect(await storage.exists(KEY)).toBe(true);

    const file = await storage.get(KEY);
    expect(file?.contentType).toBe("text/plain");
    expect(file?.size).toBe(4);
    expect(new TextDecoder().decode(await readAll(file!.stream))).toBe("hola");
    // Never an old copy from a cache (Vercel Blob was read with useCache: false).
    expect(api.requests.at(-1)).toMatchObject({ method: "GET", path: `${OBJECTS_PATH}/${KEY}`, cache: "no-store" });

    await storage.delete(KEY);
    expect(api.requests.at(-1)).toMatchObject({ method: "DELETE", path: OBJECTS_PATH, body: { prefixes: [KEY] } });
    expect(await storage.get(KEY)).toBeNull();
    expect(await storage.exists(KEY)).toBe(false);
    // An existing private bucket is used as it is.
    expect(calls(api)).not.toContain("POST /storage/v1/bucket");
    for (const request of api.requests) expect(request.path).toMatch(PRIVATE_ENDPOINTS);
  });

  it("overwrites the same key, as the disk does, and keeps a file without type as a generic binary", async () => {
    const api = fakeStorageApi({ bucket: { public: false } });
    const storage = supabaseStorage(api);
    await storage.put(KEY, bytes("primera"), "image/png");
    await storage.put(KEY, bytes("segunda versión"), "image/webp");
    const file = await storage.get(KEY);
    expect(file).toMatchObject({ contentType: "image/webp", size: bytes("segunda versión").byteLength });
    expect(new TextDecoder().decode(await readAll(file!.stream))).toBe("segunda versión");

    await storage.put("kb/2026/09/sin-tipo", bytes("x"), "");
    expect((await storage.get("kb/2026/09/sin-tipo"))?.contentType).toBe("application/octet-stream");
  });

  it("a missing file is null or false, and deleting it is fine: with no bucket yet, and in both of Storage's answers", async () => {
    const api = fakeStorageApi();
    const storage = supabaseStorage(api);
    // No bucket at all yet.
    expect(await storage.get(KEY)).toBeNull();
    expect(await storage.exists(KEY)).toBe(false);
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
    // A bucket without the file: HTTP 400 with "404" in the body.
    api.bucket = { public: false };
    expect(await storage.get(KEY)).toBeNull();
    expect(await storage.exists(KEY)).toBe(false);
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
    // The newer answer: HTTP 404 with its code.
    api.answer = (request) => (request.method === "HEAD" ? new Response(null, { status: 404 }) : json({ code: "NoSuchKey", message: "The specified key does not exist." }, 404));
    expect(await storage.get(KEY)).toBeNull();
    expect(await storage.exists(KEY)).toBe(false);
    // Looking never creates anything.
    expect(calls(api).filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("checks the bucket once per process, even with several uploads at the same time", async () => {
    const api = fakeStorageApi();
    const storage = supabaseStorage(api);
    await Promise.all([storage.put("media/2026/09/a.png", bytes("a"), "image/png"), storage.put("media/2026/09/b.png", bytes("b"), "image/png")]);
    await storage.put("media/2026/09/c.png", bytes("c"), "image/png");
    expect(calls(api).filter((call) => call.includes("/storage/v1/bucket"))).toEqual([`GET ${BUCKET_PATH}`, "POST /storage/v1/bucket"]);
    expect([...api.objects.keys()].sort()).toEqual(["media/2026/09/a.png", "media/2026/09/b.png", "media/2026/09/c.png"]);
  });

  it("two servers starting at once: both find no bucket, one creates it and the other's «already exists» is fine", async () => {
    const api = fakeStorageApi();
    let lookups = 0;
    let bothLooked = () => {};
    const barrier = new Promise<void>((resolve) => (bothLooked = resolve));
    api.answer = async (request) => {
      if (request.method !== "GET" || request.path !== BUCKET_PATH) return undefined;
      if (++lookups === 2) bothLooked();
      await barrier;
      return bucketNotFound();
    };
    const [first, second] = [supabaseStorage(api), supabaseStorage(api)];
    await Promise.all([first.put("media/2026/09/a.png", bytes("a"), "image/png"), second.put("media/2026/09/b.png", bytes("b"), "image/png")]);
    expect(calls(api).filter((call) => call === "POST /storage/v1/bucket")).toHaveLength(2);
    expect(api.bucket).toEqual({ public: false });
    expect(api.objects.size).toBe(2);
  });

  it("if creating the bucket fails, the next upload tries again", async () => {
    const api = fakeStorageApi();
    api.answer = (request) => (request.method === "POST" && request.path === "/storage/v1/bucket" ? failure(500, "Internal Server Error")(request) : undefined);
    const storage = supabaseStorage(api);
    await expect(storage.put(KEY, bytes("x"), "image/png")).rejects.toThrow("Internal Server Error");
    expect(api.objects.size).toBe(0);
    api.answer = undefined;
    await storage.put(KEY, bytes("x"), "image/png");
    expect(api.bucket).toEqual({ public: false });
    expect(api.objects.has(KEY)).toBe(true);
  });

  it("never uses a public bucket: its files could be opened without permission", async () => {
    const api = fakeStorageApi({ bucket: { public: true } });
    await expect(supabaseStorage(api).put(KEY, bytes("x"), "image/png")).rejects.toThrow(`El bucket «${SUPABASE_BUCKET}» de Supabase Storage es público`);
    expect(calls(api)).toEqual([`GET ${BUCKET_PATH}`]);
    expect(api.objects.size).toBe(0);
  });

  it("any other failure is an error, never a missing file, and never shows the secret key", async () => {
    const api = fakeStorageApi({ bucket: { public: false } });
    const storage = supabaseStorage(api);
    await storage.put(KEY, bytes("x"), "image/png");

    // Storage fails.
    api.answer = failure(500, "Internal Server Error");
    await expect(storage.get(KEY)).rejects.toThrow("Internal Server Error");
    await expect(storage.exists(KEY)).rejects.toMatchObject({ status: 500 });
    await expect(storage.delete(KEY)).rejects.toThrow("Internal Server Error");
    // Storage refuses the key (for example, the publishable key instead of the secret one).
    api.answer = (request) =>
      request.method === "POST" ? json({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }, 400) : undefined;
    const refused: unknown = await storage.put("media/2026/09/otra.png", bytes("x"), "image/png").catch((error: unknown) => error);
    expect(refused).toMatchObject({ statusCode: "403", message: "new row violates row-level security policy" });
    // No connection.
    api.answer = () => {
      throw new TypeError("fetch failed");
    };
    const offline: unknown = await storage.get(KEY).catch((error: unknown) => error);
    expect(offline).toMatchObject({ message: "fetch failed" });
    await expect(storage.exists(KEY)).rejects.toThrow("fetch failed");
    await expect(storage.delete(KEY)).rejects.toThrow("fetch failed");

    expect(api.objects.has(KEY)).toBe(true);
    for (const error of [refused, offline]) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(SECRET_KEY);
      expect(JSON.stringify(error)).not.toContain(SECRET_KEY);
    }
  });

  it("rejects invalid keys before calling Storage", async () => {
    const api = fakeStorageApi({ bucket: { public: false } });
    const storage = supabaseStorage(api);
    await expect(storage.put("../x", bytes("x"), "text/plain")).rejects.toThrow(InvalidFileKeyError);
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(InvalidFileKeyError);
    await expect(storage.exists("a//b")).rejects.toThrow(InvalidFileKeyError);
    await expect(storage.delete("../x")).rejects.toThrow(InvalidFileKeyError);
    expect(api.requests).toHaveLength(0);
  });
});

describe("which file storage is used", () => {
  const supabase = { SUPABASE_URL, SUPABASE_SECRET_KEY: SECRET_KEY };

  it("Supabase Storage when SUPABASE_URL and SUPABASE_SECRET_KEY are set", () => {
    expect(isSupabaseStorageConfigured(supabase)).toBe(true);
    const storage = createFileStorage(supabase);
    expect(storage).toBeInstanceOf(SupabaseStorage);
    expect(storage.kind).toBe("supabase");
  });

  it("the disk (data/uploads) without both of them, as in a local installation", () => {
    for (const env of [{}, { SUPABASE_URL }, { SUPABASE_SECRET_KEY: SECRET_KEY }, { SUPABASE_URL: " ", SUPABASE_SECRET_KEY: " " }]) {
      expect(isSupabaseStorageConfigured(env), JSON.stringify(env)).toBe(false);
      expect(createFileStorage(env), JSON.stringify(env)).toBeInstanceOf(DiskStorage);
    }
  });

  it("on Vercel without both of them, a clear error: its disk does not keep the files", () => {
    for (const env of [{ VERCEL: "1" }, { VERCEL: "1", SUPABASE_URL }, { VERCEL: "1", SUPABASE_SECRET_KEY: SECRET_KEY }]) {
      expect(() => createFileStorage(env), JSON.stringify(env)).toThrow("Faltan SUPABASE_URL y SUPABASE_SECRET_KEY: en Vercel los archivos se guardan en Supabase Storage");
    }
    expect(createFileStorage({ VERCEL: "1", ...supabase })).toBeInstanceOf(SupabaseStorage);
  });

  it("the Supabase client is only created when a file is used", async () => {
    // A wrong URL fails when a file is used, never when the app picks its storage.
    const storage = createFileStorage({ SUPABASE_URL: "no-es-una-url", SUPABASE_SECRET_KEY: SECRET_KEY });
    await expect(storage.get(KEY)).rejects.toThrow("Invalid supabaseUrl");
  });
});
