// Uploading a file to a knowledge base ([CON-04], [CON-14], [SEG-04], [SEG-06], [SEG-13]): the raw file goes to its own
// route (Server Actions take 4 MB and Next's proxy would cut bodies over 10 MB), which checks the session, the
// permission, the origin and the size, and stores it through src/data with a generated key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, jobs, kbDocuments, knowledgeBases, rateLimits } from "@/db/schema";
import { createKnowledgeBase } from "@/data/knowledge";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { makePdf } from "@/server/media/test-fixtures";
import { createBusiness, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null, storageDir: "" }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("@/server/inbound/ingest", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/inbound/ingest")>()), kickTick: vi.fn() }));
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  let storage: InstanceType<typeof actual.DiskStorage> | undefined;
  return { ...actual, getFileStorage: () => (storage ??= new actual.DiskStorage(state.storageDir)) };
});

import { kickTick } from "@/server/inbound/ingest";
import { FILE_NAME_HEADER } from "./paths";
import { handleKnowledgeUpload } from "./upload";
import { KNOWLEDGE_ADD_LIMIT } from "./work";

const ORIGIN = "http://localhost:3000";
const utf8 = (text: string) => new TextEncoder().encode(text);
const users = {} as Record<Role, TestUser>;
let kbId: string;

type UploadOptions = { fileName?: string | null; origin?: string | null; headers?: Record<string, string> };

function upload(bytes: Uint8Array, options: UploadOptions = {}, base = kbId): Promise<Response> {
  const headers = new Headers({ host: "localhost:3000", "content-type": "application/octet-stream", ...options.headers });
  const fileName = options.fileName === undefined ? "normas.txt" : options.fileName;
  if (fileName !== null) headers.set(FILE_NAME_HEADER, encodeURIComponent(fileName));
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const request = new Request(`${ORIGIN}/api/knowledge/bases/${base}/files`, { method: "POST", headers, body: bytes, duplex: "half" } as RequestInit);
  return handleKnowledgeUpload(request, Promise.resolve({ id: base }));
}

const documents = () => db.select().from(kbDocuments);
const storedFiles = () => (fs.readdirSync(state.storageDir, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter((entry) => entry.isFile()).length;

beforeAll(async () => {
  state.storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-knowledge-upload-"));
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
});

afterAll(() => fs.rmSync(state.storageDir, { recursive: true, force: true }));

beforeEach(async () => {
  state.actor = users.owner.actor;
  for (const table of [kbDocuments, knowledgeBases, jobs, auditLog, rateLimits]) await db.delete(table);
  kbId = (await createKnowledgeBase(users.owner.actor, { name: "Peluquería" })).id;
  vi.mocked(kickTick).mockClear();
});

describe("uploading a file [CON-04] [CON-05]", () => {
  it.each(["owner", "admin", "supervisor"] as const)("%s uploads a file: it is stored «en cola» and its processing starts at once", async (role) => {
    state.actor = users[role].actor;
    const response = await upload(makePdf(["Precios del salón para 2026: corte 25 euros, tinte 40 euros."]), { fileName: "Tarifas 2026 (ñ).pdf" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; message: string };
    expect(body).toEqual({ id: expect.any(String), message: "Archivo añadido. Se está procesando." });
    const [doc] = await documents();
    expect(doc).toMatchObject({ id: body.id, kbId, sourceType: "file", fileName: "Tarifas 2026 (ñ).pdf", title: "Tarifas 2026 (ñ)", status: "queued", createdBy: users[role].userId });
    // A generated key: the name typed by the person is never a path.
    expect(doc.fileKey).toMatch(/^knowledge\/\d{4}\/\d{2}\/[0-9a-f-]+\.pdf$/);
    expect(fs.existsSync(path.join(state.storageDir, ...(doc.fileKey ?? "").split("/")))).toBe(true);
    expect(kickTick).toHaveBeenCalledWith({ maxDurationSec: 60 });
  });

  it("the same file twice is refused with «Este archivo ya está en la base» [CON-14]", async () => {
    const bytes = utf8("## Normas\n\nNo se admiten mascotas.");
    expect((await upload(bytes)).status).toBe(201);
    const again = await upload(bytes, { fileName: "copia.txt" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "Este archivo ya está en la base." });
    expect(await documents()).toHaveLength(1);
  });

  it("another type, a disguised file or an old .xls is refused with its reason; nothing is stored", async () => {
    const filesBefore = storedFiles();
    const photo = await upload(utf8("no soy una foto"), { fileName: "foto.jpg" });
    expect(photo.status).toBe(400);
    expect(await photo.json()).toMatchObject({ error: "Ese tipo de archivo no se admite. Sube un PDF, DOCX, XLSX, CSV, TXT o MD." });
    expect((await upload(utf8("hola"), { fileName: "falso.pdf" })).status).toBe(400);
    const old = await upload(utf8("x"), { fileName: "viejo.xls" });
    expect(await old.json()).toMatchObject({ error: expect.stringMatching(/\.xls antiguos/) });
    expect((await upload(new Uint8Array(), { fileName: "vacio.txt" })).status).toBe(400);
    expect(await documents()).toEqual([]);
    expect(storedFiles()).toBe(filesBefore);
  });

  it("a file over 25 MB is refused before it is read", async () => {
    const response = await upload(utf8("%PDF-1.4"), { fileName: "enorme.pdf", headers: { "content-length": String(25 * 1024 * 1024 + 1) } });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "El archivo es demasiado grande. El máximo es 25 MB." });
    const streamed = new Uint8Array(25 * 1024 * 1024 + 1);
    streamed.set(utf8("%PDF-1.4"));
    expect((await upload(streamed, { fileName: "enorme.pdf" })).status).toBe(413);
    expect(await documents()).toEqual([]);
  });

  it("without the file name, or with a malformed one, it is refused", async () => {
    expect((await upload(utf8("hola"), { fileName: null })).status).toBe(400);
    const request = new Request(`${ORIGIN}/api/knowledge/bases/${kbId}/files`, {
      method: "POST",
      headers: { host: "localhost:3000", origin: ORIGIN, [FILE_NAME_HEADER]: "%E0%A4%A" },
      body: utf8("hola"),
      duplex: "half",
    } as RequestInit);
    expect((await handleKnowledgeUpload(request, Promise.resolve({ id: kbId }))).status).toBe(400);
    expect(await documents()).toEqual([]);
  });

  it("an unknown base answers «not found»", async () => {
    const response = await upload(utf8("hola"), {}, crypto.randomUUID());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "No se ha encontrado la base de conocimiento." });
  });
});

describe("who may upload [PER-01] [SEG-04] [SEG-06]", () => {
  it.each(["agent", "viewer"] as const)("%s gets 403 and nothing is stored", async (role) => {
    state.actor = users[role].actor;
    const response = await upload(utf8("hola"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "No tienes permiso para hacer esto." });
    expect(await documents()).toEqual([]);
    expect(kickTick).not.toHaveBeenCalled();
  });

  it("without a session it answers 401", async () => {
    state.actor = null;
    expect((await upload(utf8("hola"))).status).toBe(401);
    expect(await documents()).toEqual([]);
  });

  it("a request from another site, or without origin, is refused even with a valid session (CSRF)", async () => {
    expect((await upload(utf8("hola"), { origin: "https://atacante.example" })).status).toBe(403);
    expect((await upload(utf8("hola"), { origin: null })).status).toBe(403);
    expect((await upload(utf8("hola"), { origin: "no es una url" })).status).toBe(403);
    expect(await documents()).toEqual([]);
    // Behind a proxy the public host comes in x-forwarded-host.
    const proxied = await upload(utf8("detrás del proxy"), { origin: "https://salon.example", headers: { "x-forwarded-host": "salon.example" } });
    expect(proxied.status).toBe(201);
  });

  it("adding content is limited per person (each file costs AI) [SEG-07]", async () => {
    for (let n = 0; n < KNOWLEDGE_ADD_LIMIT.limit; n += 1) expect((await upload(utf8(`Documento número ${n}`), { fileName: `doc-${n}.txt` })).status).toBe(201);
    const refused = await upload(utf8("uno más"), { fileName: "otro.txt" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "Has añadido mucho contenido seguido. Espera unos minutos y sigue." });
    // Another person is not affected.
    state.actor = users.admin.actor;
    expect((await upload(utf8("de otra persona"), { fileName: "admin.txt" })).status).toBe(201);
    expect((await db.select({ n: kbDocuments.id }).from(kbDocuments).where(eq(kbDocuments.createdBy, users.owner.userId))).length).toBe(KNOWLEDGE_ADD_LIMIT.limit);
  });
});
