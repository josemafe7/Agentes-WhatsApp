// «Importar contactos» through its own route ([CTO-11], [SEG-04], [SEG-06], [SEG-07]): same origin, session and
// permission, the size before reading the body (5 MB; 4 on Vercel), «revisar» writes nothing and «importar» writes the
// contacts; the prefix and the confirmation come back next to their field.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, consents, contactIdentities, contacts, rateLimits } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { xlsxFile } from "@/server/xlsx-file";
import { actorFor, createUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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

import { handleContactImport, IMPORT_FILE_NAME_HEADER } from "./import-upload";

const ORIGIN = "http://localhost:3000";
const FILE = xlsxFile("Contactos", [
  ["Nombre", "Teléfono", "Avisos de sus citas"],
  ["Ana", "600111222", "sí"],
]);

function send(query: string, options: { origin?: string | null; bytes?: Uint8Array; fileName?: string } = {}, env: Record<string, string | undefined> = {}): Promise<Response> {
  const headers = new Headers({ host: "localhost:3000", "content-type": "application/octet-stream" });
  headers.set(IMPORT_FILE_NAME_HEADER, encodeURIComponent(options.fileName ?? "clientes.xlsx"));
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  const request = new Request(`${ORIGIN}/api/contacts/import?${query}`, { method: "POST", headers, body: options.bytes ?? FILE, duplex: "half" } as RequestInit);
  return handleContactImport(request, env);
}

beforeEach(async () => {
  for (const table of [auditLog, consents, contactIdentities, rateLimits]) await db.delete(table);
  await db.delete(contacts);
  state.actor = (await createUser("admin", { name: "Admin" })).actor;
});

describe("the import route [CTO-11]", () => {
  it("«revisar» says what would happen and writes nothing; «importar» needs the confirmation of the permissions, then imports", async () => {
    const preview = await send("paso=revisar&prefijo=%2B34");
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ fileName: "clientes.xlsx", toImport: 1, grantsPermissions: true });
    expect(await db.select().from(contacts)).toEqual([]);

    const unconfirmed = await send("paso=importar&prefijo=%2B34");
    expect(unconfirmed.status).toBe(400);
    expect(await unconfirmed.json()).toMatchObject({ fieldErrors: { confirmPermissions: [expect.any(String)] } });

    const done = await send("paso=importar&prefijo=%2B34&confirmar=1");
    expect(await done.json()).toMatchObject({ imported: 1 });
    expect((await db.select().from(contacts))[0]).toMatchObject({ name: "Ana", phone: "+34600111222" });
  });

  it("[SEG-06] refuses another origin or none; [SEG-04] without session or permission; a wrong prefix next to its field", async () => {
    expect((await send("paso=revisar&prefijo=34", { origin: "https://otra.web" })).status).toBe(403);
    expect((await send("paso=revisar&prefijo=34", { origin: null })).status).toBe(403);
    state.actor = actorFor("supervisor");
    expect((await send("paso=revisar&prefijo=34")).status).toBe(403);
    state.actor = null;
    expect((await send("paso=revisar&prefijo=34")).status).toBe(401);
    state.actor = actorFor("owner");
    const prefix = await send("paso=revisar&prefijo=34a");
    expect(prefix.status).toBe(400);
    expect(await prefix.json()).toMatchObject({ fieldErrors: { prefix: [expect.any(String)] } });
    expect((await send("paso=otro&prefijo=34")).status).toBe(400);
  });

  it("[SEG-13] a file over the limit is refused before reading it: 5 MB, 4 on Vercel", async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 10);
    const onVercel = await send("paso=revisar&prefijo=34", { bytes: big }, { VERCEL: "1" });
    expect(onVercel.status).toBe(413);
    expect(await onVercel.json()).toMatchObject({ error: "El archivo pasa de 4 MB. Divídelo en varios." });
    expect((await send("paso=revisar&prefijo=34", { bytes: new Uint8Array(5 * 1024 * 1024 + 10) })).status).toBe(413);
  });
});
