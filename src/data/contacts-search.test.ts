// Search without accents or case in Contactos and the Bandeja ([CTO-01], [BAN-02]): «jose» finds «José». Every write of a
// contact's name, phone or email keeps its search text, and the contacts from before the column get it once.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { appKv, contacts } from "@/db/schema";
import { writeContactData } from "@/server/booking/agent-tools";
import { clearContactData } from "@/server/compliance/contact-data-test-helpers";
import { upsertContactForSender } from "@/server/inbound/contacts";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { createContact, listContacts, updateContact } from "./contacts";
import { mergeContacts } from "./contacts-merge";
import { backfillContactSearchText, CONTACT_SEARCH_BACKFILL_KEY, contactSearchText } from "./contacts-search";
import { listConversations } from "./conversations";

let owner: TestUser;
let agentOfOtherChannel: TestUser;
let web: string;

beforeAll(async () => {
  await createBusiness();
  web = (await createChannel({ name: "Chat de la web" })).id;
  const other = (await createChannel({ name: "Otro chat" })).id;
  owner = await createUser("owner");
  agentOfOtherChannel = await createUser("agent", { channelIds: [other] });
});

beforeEach(async () => {
  await clearContactData();
});

const found = async (search: string) => (await listContacts(owner.actor, { search })).items.map((item) => item.name);
const searchTextOf = async (id: string) => (await db.select({ searchText: contacts.searchText }).from(contacts).where(eq(contacts.id, id)))[0]?.searchText;

describe("el texto de búsqueda de un contacto [CTO-01]", () => {
  it("is the name, phone (also as bare digits) and email, in lower case and without accents", () => {
    expect(contactSearchText({ name: "José Pérez Muñoz", phone: "+34 600 111 222", email: "JOSE@Example.com" })).toBe("jose perez munoz +34 600 111 222 34600111222 jose@example.com");
    expect(contactSearchText({ name: "  Ángela  ", phone: "34600111222", email: null })).toBe("angela 34600111222");
    expect(contactSearchText({ name: null, phone: null, email: null })).toBeNull();
  });
});

describe("buscar sin tildes en Contactos [CTO-01]", () => {
  it("«jose» finds «José», whatever the accents and the case on either side", async () => {
    await createContact(owner.actor, { name: "José Pérez Muñoz", phone: "+34 600 111 222", email: "jose@example.com" });
    await createContact(owner.actor, { name: "Marta Gil" });
    for (const search of ["jose", "JOSÉ", "Pérez", "perez", "munoz", "Muñoz", "600111222", "600 111", "jose@example"]) expect(await found(search)).toEqual(["José Pérez Muñoz"]);
    expect(await found("jesus")).toEqual([]);
  });

  it("what the person types is found as it is: «%», «_» and «\\» are not wildcards, nor an error", async () => {
    await createContact(owner.actor, { name: "Ana 50% dto" });
    await createContact(owner.actor, { name: "Ana 501" });
    await createContact(owner.actor, { name: "Luis_Gil" });
    await createContact(owner.actor, { name: "Luis Gil" });
    expect(await found("50%")).toEqual(["Ana 50% dto"]);
    expect(await found("LUIS_")).toEqual(["Luis_Gil"]);
    expect(await found("\\")).toEqual([]);
  });

  it("keeps it current when the contact changes, and when two contacts are merged", async () => {
    const { id } = await createContact(owner.actor, { name: "José" });
    await updateContact(owner.actor, id, { name: "María Ángeles" });
    expect(await found("jose")).toEqual([]);
    expect(await found("maria angeles")).toEqual(["María Ángeles"]);
    const { id: other } = await createContact(owner.actor, { name: "Mª Ángeles", email: "angeles@example.com" });
    await mergeContacts(owner.actor, { keepId: id, mergeId: other, choices: { email: "merge" } });
    expect(await searchTextOf(id)).toBe("maria angeles angeles@example.com");
  });

  it("the contacts that arrive through a channel and those the AI completes are found the same way", async () => {
    const { contactId } = await db.transaction((tx) => upsertContactForSender(tx, "webchat", { externalIds: ["visitante-1"], displayName: "Íñigo Ruiz" }, new Date()));
    expect(await found("inigo")).toEqual(["Íñigo Ruiz"]);
    await writeContactData(contactId, { name: "Íñigo Ruiz", email: "INIGO@example.com", phone: "611 222 333" });
    expect(await searchTextOf(contactId)).toBe("inigo ruiz 611 222 333 611222333 inigo@example.com");
  });
});

describe("buscar sin tildes en la Bandeja [BAN-02]", () => {
  it("«jose» finds the conversations of «José», only within the channels the person sees [PER-02]", async () => {
    const { id } = await createContact(owner.actor, { name: "José Pérez" });
    const conversation = await createConversation(web, id);
    expect((await listConversations(owner.actor, { search: "jose" })).items.map((item) => item.id)).toEqual([conversation.id]);
    expect((await listConversations(owner.actor, { search: "perez" })).items).toHaveLength(1);
    expect((await listConversations(agentOfOtherChannel.actor, { search: "jose" })).items).toEqual([]);
  });
});

describe("los contactos de antes de la búsqueda sin tildes", () => {
  it("are still found by their exact text, and without accents once the one-time backfill fills them", async () => {
    const { contact } = await createContactWithIdentity("webchat", { name: "Íñigo Ruiz", phone: "+34 611 222 333" });
    const before = (await db.select({ updatedAt: contacts.updatedAt }).from(contacts).where(eq(contacts.id, contact.id)))[0].updatedAt;
    expect(await found("Íñigo")).toEqual(["Íñigo Ruiz"]);
    expect(await found("inigo")).toEqual([]);

    expect(await backfillContactSearchText()).toEqual({ updated: 1, skipped: false });
    expect(await found("inigo")).toEqual(["Íñigo Ruiz"]);
    expect(await found("611222333")).toEqual(["Íñigo Ruiz"]);
    // It does not change when the contact was last edited.
    expect((await db.select({ updatedAt: contacts.updatedAt }).from(contacts).where(eq(contacts.id, contact.id)))[0].updatedAt).toEqual(before);
  });

  it("runs once per database, and never overwrites what a write has stored", async () => {
    const { id } = await createContact(owner.actor, { name: "Lucía" });
    await db.update(contacts).set({ searchText: "texto de una escritura" }).where(eq(contacts.id, id));
    expect(await backfillContactSearchText()).toEqual({ updated: 0, skipped: false });
    expect(await searchTextOf(id)).toBe("texto de una escritura");
    expect(await db.select().from(appKv).where(eq(appKv.key, CONTACT_SEARCH_BACKFILL_KEY))).toHaveLength(1);
    // Later writes keep their own search text; one written without it is still found by its exact text.
    const { contact: ramon } = await createContactWithIdentity("webchat", { name: "Ramón" });
    expect(await backfillContactSearchText()).toEqual({ updated: 0, skipped: true });
    expect(await searchTextOf(ramon.id)).toBeNull();
    expect(await found("Ramón")).toEqual(["Ramón"]);
  });
});
