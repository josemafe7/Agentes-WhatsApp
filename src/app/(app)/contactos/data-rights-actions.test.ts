// The data rights of a contact through its Server Actions, called directly as an attacker could ([SEG-04], [PER-01]):
// «Contactos: exportar y borrar datos» (Propietario and Administrador) and «Contactos: fusionar duplicados» (also
// Supervisor). A refused call changes nothing and leaves nothing in the activity log.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, contacts } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { clearContactData } from "@/server/compliance/contact-data-test-helpers";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

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
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { eraseContactAction, exportContactDataAction, exportContactsCsvAction, mergeContactsAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const EXPIRED = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
const ROLES: Role[] = ["owner", "admin", "supervisor", "agent", "viewer"];
const users = {} as Record<Role, TestUser>;
let channelId: string;
let ana: string;
let anaAgain: string;

const contactIds = async () => (await db.select({ id: contacts.id }).from(contacts)).map((row) => row.id).sort();

beforeAll(async () => {
  await createBusiness();
  channelId = (await createChannel({ name: "Chat de la web" })).id;
  for (const role of ROLES) users[role] = await createUser(role);
});

beforeEach(async () => {
  await clearContactData();
  ana = (await createContactWithIdentity("webchat", { name: "Ana García", email: "ana@example.com" })).contact.id;
  anaAgain = (await createContactWithIdentity("webchat", { name: "ana garcia", email: "ana@example.com" })).contact.id;
  await createMessage(await createConversation(channelId, ana), { text: "Hola, soy Ana." });
  await createMessage(await createConversation(channelId, anaAgain), { text: "Hola otra vez." });
});

describe("Exportar [CTO-06] [CUM-07]", () => {
  it.each(["owner", "admin"] as const)("%s exports the data of a contact and the list", async (role) => {
    state.actor = users[role].actor;
    const one = await exportContactDataAction(ana);
    expect(one).toMatchObject({ ok: true, message: "Datos exportados.", data: { mimeType: "application/json", fileName: expect.stringMatching(/^datos-contacto-.+\.json$/) } });
    expect(one.ok && one.data?.content).toContain("Hola, soy Ana.");
    const list = await exportContactsCsvAction({});
    expect(list).toMatchObject({ ok: true, message: "2 contactos exportados.", data: { fileName: expect.stringMatching(/^contactos-.+\.csv$/) } });
    expect(await exportContactsCsvAction({ ids: [ana] })).toMatchObject({ ok: true, message: "1 contacto exportado." });
  });

  it.each(["supervisor", "agent", "viewer"] as const)("%s may not export [PER-01]", async (role) => {
    state.actor = users[role].actor;
    expect(await exportContactDataAction(ana)).toEqual(FORBIDDEN);
    expect(await exportContactsCsvAction({})).toEqual(FORBIDDEN);
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe("Borrar contacto [CTO-07] [CUM-07]", () => {
  it.each(["owner", "admin"] as const)("%s erases a contact typing its name", async (role) => {
    state.actor = users[role].actor;
    expect(await eraseContactAction(ana, { confirmName: "Ana" })).toEqual({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { confirmName: ["Escribe el nombre exacto del contacto para borrarlo."] },
    });
    expect(await eraseContactAction(ana, { confirmName: "Ana García" })).toEqual({ ok: true, message: "Contacto borrado." });
    expect(await contactIds()).toEqual([anaAgain]);
  });

  it.each(["supervisor", "agent", "viewer"] as const)("%s may not erase, and nothing changes [PER-01]", async (role) => {
    state.actor = users[role].actor;
    expect(await eraseContactAction(ana, { confirmName: "Ana García" })).toEqual(FORBIDDEN);
    expect(await contactIds()).toEqual([ana, anaAgain].sort());
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe("Fusionar contactos [CTO-05]", () => {
  it.each(["owner", "admin", "supervisor"] as const)("%s merges two contacts and gets the one that stays", async (role) => {
    state.actor = users[role].actor;
    expect(await mergeContactsAction({ keepId: ana, mergeId: anaAgain })).toEqual({ ok: true, message: "Contactos fusionados.", data: { keepId: ana } });
    expect(await contactIds()).toEqual([ana]);
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "contact.merged"))).map((entry) => entry.actorUserId)).toEqual([users[role].userId]);
  });

  it.each(["agent", "viewer"] as const)("%s may not merge, and nothing changes [PER-01]", async (role) => {
    state.actor = users[role].actor;
    expect(await mergeContactsAction({ keepId: ana, mergeId: anaAgain })).toEqual(FORBIDDEN);
    expect(await contactIds()).toEqual([ana, anaAgain].sort());
  });

  it("says what is wrong with what it receives [SEG-05]", async () => {
    state.actor = users.owner.actor;
    expect(await mergeContactsAction({ keepId: ana, mergeId: ana })).toMatchObject({ ok: false, fieldErrors: { mergeId: ["Elige dos contactos distintos."] } });
    expect(await mergeContactsAction({ keepId: ana })).toMatchObject({ ok: false });
    expect(await contactIds()).toEqual([ana, anaAgain].sort());
  });
});

describe("without a session [SEG-04]", () => {
  it("every action asks to sign in again and nothing changes", async () => {
    state.actor = null;
    expect(await exportContactDataAction(ana)).toEqual(EXPIRED);
    expect(await exportContactsCsvAction({})).toEqual(EXPIRED);
    expect(await eraseContactAction(ana, { confirmName: "Ana García" })).toEqual(EXPIRED);
    expect(await mergeContactsAction({ keepId: ana, mergeId: anaAgain })).toEqual(EXPIRED);
    expect(await contactIds()).toEqual([ana, anaAgain].sort());
  });
});
