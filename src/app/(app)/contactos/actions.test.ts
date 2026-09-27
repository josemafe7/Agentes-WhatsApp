// Server Actions of Contactos called directly, as an attacker could ([SEG-04], [PER-01]): who may create and edit a
// contact, an Agent only through a conversation in their channels ([PER-02]), and nothing changes when refused.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, consents, contactIdentities, contacts, conversations, messages } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";

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

import { CUSTOM_FIELD_NAME_MAX, CUSTOM_FIELD_VALUE_MAX } from "./_lib/custom-fields";
import { createContactAction, updateContactAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const EXPIRED = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };

let users: Record<"owner" | "admin" | "supervisor" | "agentA" | "viewer", TestUser>;
let channelA: string;
let channelB: string;
let ana: string;
let bruno: string;

const contactRow = async (id: string) => (await db.select().from(contacts).where(eq(contacts.id, id)))[0];
const contactRows = async () => db.select().from(contacts);

beforeAll(async () => {
  await createBusiness();
  channelA = (await createChannel({ name: "Chat de la web" })).id;
  channelB = (await createChannel({ name: "WhatsApp Recepción", type: "whatsapp", isDemo: true })).id;
  users = {
    owner: await createUser("owner"),
    admin: await createUser("admin"),
    supervisor: await createUser("supervisor"),
    agentA: await createUser("agent", { channelIds: [channelA] }),
    viewer: await createUser("viewer"),
  };
});

beforeEach(async () => {
  state.actor = users.owner.actor;
  for (const table of [consents, messages, conversations, contactIdentities, contacts, auditLog]) await db.delete(table);
  ana = (await createContactWithIdentity("webchat", { name: "Ana", externalId: "visitor-ana" })).contact.id;
  bruno = (await createContactWithIdentity("whatsapp", { name: "Bruno", externalId: "ES.bsuid-bruno", phone: "34600111222" })).contact.id;
  await db.update(contacts).set({ phone: "+34 600 111 222" }).where(eq(contacts.id, bruno));
  await createConversation(channelA, ana);
  await createConversation(channelB, bruno);
});

describe("Nuevo contacto [CTO-01]", () => {
  it.each(["owner", "admin", "supervisor"] as const)("%s creates a contact by hand with its data, labels and fields", async (role) => {
    state.actor = users[role].actor;
    const result = await createContactAction({
      name: "  Carla Ruiz ",
      phone: "+34 611 000 000",
      email: "Carla@Example.com",
      labels: ["nueva", "nueva", "vip"],
      customFields: { alergias: "ninguna" },
    });
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) }, message: "Contacto creado." });
    const row = await contactRow(result.ok ? (result.data?.id ?? "") : "");
    expect(row).toMatchObject({
      name: "Carla Ruiz",
      phone: "+34 611 000 000",
      email: "carla@example.com",
      labels: ["nueva", "vip"],
      customFields: { alergias: "ninguna" },
    });
  });

  it("needs a name, a phone or an email, and says which field is wrong; nothing is saved", async () => {
    expect(await createContactAction({ name: "", phone: "", email: "" })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
    expect(await createContactAction({ name: "Carla", email: "no-es-un-email" })).toMatchObject({ ok: false, fieldErrors: { email: expect.any(Array) } });
    expect(await createContactAction({ name: "Carla", phone: "llámame" })).toMatchObject({ ok: false, fieldErrors: { phone: ["Escribe un teléfono válido."] } });
    expect(await createContactAction({ name: "Carla", role: "owner" })).toMatchObject({ ok: false });
    expect(await createContactAction(null)).toMatchObject({ ok: false });
    expect(await createContactAction("Carla")).toMatchObject({ ok: false });
    expect((await contactRows()).map((row) => row.name).sort()).toEqual(["Ana", "Bruno"]);
  });

  it("the same phone as another contact creates a separate contact: the phone is never a key [CAN-13]", async () => {
    const result = await createContactAction({ name: "Bruno (trabajo)", phone: "+34 600 111 222" });
    expect(result.ok).toBe(true);
    expect(await contactRows()).toHaveLength(3);
    expect(await contactRow(bruno)).toMatchObject({ name: "Bruno", phone: "+34 600 111 222" });
    // Its identities stay with Bruno.
    const identities = await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, bruno));
    expect(identities).toHaveLength(1);
  });

  it("Solo lectura cannot create a contact [PER-03]", async () => {
    state.actor = users.viewer.actor;
    expect(await createContactAction({ name: "Intruso" })).toEqual(FORBIDDEN);
    expect(await contactRows()).toHaveLength(2);
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe("Editar la ficha [CTO-01] [CTO-02]", () => {
  it("saves the data and only what was sent changes", async () => {
    await db.update(contacts).set({ labels: ["vip"], customFields: { alergias: "ninguna" } }).where(eq(contacts.id, ana));
    const result = await updateContactAction(ana, { name: "Ana López", phone: "+34 622 333 444", email: "ana@example.com", notes: "Prefiere las tardes." });
    expect(result).toEqual({ ok: true, message: "Cambios guardados." });
    expect(await contactRow(ana)).toMatchObject({
      name: "Ana López",
      phone: "+34 622 333 444",
      email: "ana@example.com",
      notes: "Prefiere las tardes.",
      labels: ["vip"],
      customFields: { alergias: "ninguna" },
    });
  });

  it("empty fields are cleared", async () => {
    await updateContactAction(ana, { phone: "+34 622 333 444", email: "ana@example.com", notes: "Algo" });
    expect(await updateContactAction(ana, { phone: "", email: "", notes: "" })).toMatchObject({ ok: true });
    expect(await contactRow(ana)).toMatchObject({ name: "Ana", phone: null, email: null, notes: null });
  });

  it("saves the labels without repeating them", async () => {
    expect(await updateContactAction(ana, { labels: [" vip ", "vip", "habitual"] })).toMatchObject({ ok: true });
    expect((await contactRow(ana)).labels).toEqual(["vip", "habitual"]);
    expect(await updateContactAction(ana, { labels: [] })).toMatchObject({ ok: true });
    expect((await contactRow(ana)).labels).toEqual([]);
  });

  it("refuses too many or too long labels and nothing changes", async () => {
    const tooMany = Array.from({ length: 21 }, (_, index) => `etiqueta-${index}`);
    expect(await updateContactAction(ana, { labels: tooMany })).toMatchObject({ ok: false, fieldErrors: { labels: expect.any(Array) } });
    expect(await updateContactAction(ana, { labels: ["x".repeat(41)] })).toMatchObject({ ok: false, fieldErrors: { labels: expect.any(Array) } });
    expect(await updateContactAction(ana, { labels: [""] })).toMatchObject({ ok: false });
    expect((await contactRow(ana)).labels).toEqual([]);
  });

  it("saves the custom fields (name and value) and replaces the previous ones", async () => {
    expect(await updateContactAction(ana, { customFields: { alergias: "ninguna", "color favorito": "azul" } })).toMatchObject({ ok: true });
    expect((await contactRow(ana)).customFields).toEqual({ alergias: "ninguna", "color favorito": "azul" });
    expect(await updateContactAction(ana, { customFields: { alergias: "polen" } })).toMatchObject({ ok: true });
    expect((await contactRow(ana)).customFields).toEqual({ alergias: "polen" });
  });

  it("refuses too many custom fields or too long names and values", async () => {
    const tooMany = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`campo ${index}`, "x"]));
    expect(await updateContactAction(ana, { customFields: tooMany })).toMatchObject({ ok: false, fieldErrors: { customFields: expect.any(Array) } });
    expect(await updateContactAction(ana, { customFields: { ["n".repeat(CUSTOM_FIELD_NAME_MAX + 1)]: "x" } })).toMatchObject({ ok: false });
    expect(await updateContactAction(ana, { customFields: { alergias: "x".repeat(CUSTOM_FIELD_VALUE_MAX + 1) } })).toMatchObject({ ok: false });
    expect(await updateContactAction(ana, { customFields: { alergias: 3 } })).toMatchObject({ ok: false });
    expect((await contactRow(ana)).customFields).toEqual({});
  });

  it("the form's limits for custom fields are the server's", async () => {
    const longest = { ["n".repeat(CUSTOM_FIELD_NAME_MAX)]: "v".repeat(CUSTOM_FIELD_VALUE_MAX) };
    expect(await updateContactAction(ana, { customFields: longest })).toMatchObject({ ok: true });
    expect((await contactRow(ana)).customFields).toEqual(longest);
  });

  it("refuses wrong data with the error next to the field and unknown fields", async () => {
    expect(await updateContactAction(ana, { email: "ana@" })).toMatchObject({ ok: false, fieldErrors: { email: expect.any(Array) } });
    expect(await updateContactAction(ana, { name: "x".repeat(101) })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
    expect(await updateContactAction(ana, { id: bruno })).toMatchObject({ ok: false });
    expect(await updateContactAction(ana, null)).toMatchObject({ ok: false });
    expect(await contactRow(ana)).toMatchObject({ name: "Ana", email: null });
  });

  it("an unknown or malformed contact gets the same answer as one that is not yours", async () => {
    expect(await updateContactAction(crypto.randomUUID(), { name: "X" })).toEqual(FORBIDDEN);
    expect(await updateContactAction("no-es-un-id", { name: "X" })).toEqual(FORBIDDEN);
    expect(await updateContactAction(42, { name: "X" })).toEqual(FORBIDDEN);
  });

  it("leaves a note in the activity log without personal data [SEG-10]", async () => {
    await updateContactAction(ana, { name: "Ana López", email: "ana@example.com" });
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ action: "contact.updated", targetType: "contact", targetId: ana });
    expect(JSON.stringify(entry)).not.toContain("ana@example.com");
  });
});

describe("Contactos for an Agent: only those of their channels [PER-02]", () => {
  it("edits a contact with a conversation in their channels", async () => {
    state.actor = users.agentA.actor;
    expect(await updateContactAction(ana, { notes: "Viene los martes.", labels: ["habitual"] })).toMatchObject({ ok: true });
    expect(await contactRow(ana)).toMatchObject({ notes: "Viene los martes.", labels: ["habitual"] });
  });

  it("cannot edit a contact of another channel, and nothing changes", async () => {
    state.actor = users.agentA.actor;
    expect(await updateContactAction(bruno, { name: "Otro", labels: ["x"], customFields: { a: "b" } })).toEqual(FORBIDDEN);
    expect(await contactRow(bruno)).toMatchObject({ name: "Bruno", labels: [], customFields: {} });
  });

  it("when the contact also writes through their channel, they can edit it", async () => {
    await createConversation(channelA, bruno);
    state.actor = users.agentA.actor;
    expect(await updateContactAction(bruno, { notes: "Escribe por la web también." })).toMatchObject({ ok: true });
  });
});

describe.each<Role>(["viewer"])("Contactos as %s [PER-03] [SEG-04]", (role) => {
  it("cannot edit anything, and nothing changes", async () => {
    state.actor = (await createUser(role)).actor;
    expect(await updateContactAction(ana, { name: "Intruso" })).toEqual(FORBIDDEN);
    expect(await updateContactAction(ana, { labels: ["x"] })).toEqual(FORBIDDEN);
    expect(await updateContactAction(ana, { customFields: { a: "b" } })).toEqual(FORBIDDEN);
    expect(await contactRow(ana)).toMatchObject({ name: "Ana", labels: [], customFields: {} });
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe("Contactos without a session [SEG-04]", () => {
  it("every action asks to sign in again and nothing changes", async () => {
    state.actor = null;
    expect(await createContactAction({ name: "Carla" })).toEqual(EXPIRED);
    expect(await updateContactAction(ana, { name: "X" })).toEqual(EXPIRED);
    expect((await contactRows()).map((row) => row.name).sort()).toEqual(["Ana", "Bruno"]);
  });
});
