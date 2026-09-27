import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { consents, contactIdentities, contacts, conversations, messages, userRoles } from "@/db/schema";
import { AuthError, ValidationError } from "@/server/errors";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { createContact, getContact, listContactLabels, listContacts, updateContact } from "./contacts";

let users: Record<"owner" | "supervisor" | "agentA" | "agentAll" | "viewer", TestUser>;
let channelA: string;
let channelB: string;
let ana: string;
let bruno: string;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}
const forbidden = async (promise: Promise<unknown>) => expect(await errorOf(promise)).toBeInstanceOf(AuthError);

beforeAll(async () => {
  await createBusiness();
  await db.delete(userRoles);
  channelA = (await createChannel({ name: "Web A" })).id;
  channelB = (await createChannel({ name: "WhatsApp B", type: "whatsapp", isDemo: true })).id;
  users = {
    owner: await createUser("owner"),
    supervisor: await createUser("supervisor"),
    agentA: await createUser("agent", { channelIds: [channelA] }),
    agentAll: await createUser("agent"),
    viewer: await createUser("viewer"),
  };
});

beforeEach(async () => {
  for (const table of [consents, messages, conversations, contactIdentities, contacts]) await db.delete(table);
  const a = await createContactWithIdentity("webchat", { name: "Ana", externalId: "visitor-ana" });
  ana = a.contact.id;
  await db.update(contacts).set({ labels: ["vip"], email: "ana@example.com" }).where(eq(contacts.id, ana));
  const b = await createContactWithIdentity("whatsapp", { name: "Bruno", externalId: "ES.bsuid-bruno", phone: "34600111222" });
  bruno = b.contact.id;
  await createConversation(channelA, ana);
  await createConversation(channelB, bruno);
  await createConversation(channelB, ana);
});

describe("contact list [CTO-01] [PER-02]", () => {
  const names = async (actor: TestUser["actor"], filters: Record<string, unknown> = {}) => (await listContacts(actor, filters)).items.map((item) => item.name);

  it("everyone who may see contacts sees them; an agent only those with a conversation in their channels", async () => {
    for (const role of ["owner", "supervisor", "agentAll", "viewer"] as const) expect(await names(users[role].actor)).toEqual(["Ana", "Bruno"]);
    expect(await names(users.agentA.actor)).toEqual(["Ana"]);
  });

  it("searches and filters by label and channel", async () => {
    expect(await names(users.owner.actor, { search: "600111" })).toEqual(["Bruno"]);
    expect(await names(users.owner.actor, { search: "ana@" })).toEqual(["Ana"]);
    expect(await names(users.owner.actor, { label: "vip" })).toEqual(["Ana"]);
    expect(await names(users.owner.actor, { channelType: "whatsapp" })).toEqual(["Bruno"]);
    expect(await names(users.owner.actor, { channelId: channelB })).toEqual(["Ana", "Bruno"]);
  });

  it("an agent filtering by a channel that is not theirs sees nothing", async () => {
    expect(await names(users.agentA.actor, { channelId: channelB })).toEqual([]);
    expect(await names(users.agentA.actor, { channelId: channelA })).toEqual(["Ana"]);
  });

  it("shows the channel types of each contact", async () => {
    const { items } = await listContacts(users.owner.actor);
    expect(items.find((item) => item.name === "Bruno")?.channelTypes).toEqual(["whatsapp"]);
  });

  it("lists the labels in use for the label filter, only of the contacts the person may see", async () => {
    await db.update(contacts).set({ labels: ["vip", "habitual"] }).where(eq(contacts.id, ana));
    await db.update(contacts).set({ labels: ["Nueva", "vip"] }).where(eq(contacts.id, bruno));
    for (const role of ["owner", "supervisor", "agentAll", "viewer"] as const) expect(await listContactLabels(users[role].actor)).toEqual(["habitual", "Nueva", "vip"]);
    expect(await listContactLabels(users.agentA.actor)).toEqual(["habitual", "vip"]);
  });
});

describe("contact card [CTO-02] [CTO-03]", () => {
  it("shows data, identities, consents and the conversations the person may see", async () => {
    await db.insert(consents).values({ contactId: ana, channelId: channelB, type: "opt_out", source: "BAJA" });
    const card = await getContact(users.owner.actor, ana);
    expect(card).toMatchObject({ name: "Ana", email: "ana@example.com", labels: ["vip"] });
    expect(card.identities.map((identity) => [identity.channelType, identity.externalId])).toEqual([["webchat", "visitor-ana"]]);
    expect(card.consents.map((consent) => [consent.type, consent.channelName])).toEqual([["opt_out", "WhatsApp B"]]);
    expect(card.conversations).toHaveLength(2);
    // An agent of channel A only sees Ana's conversation there.
    const limited = await getContact(users.agentA.actor, ana);
    expect(limited.conversations.map((conversation) => conversation.channel.id)).toEqual([channelA]);
    await forbidden(getContact(users.agentA.actor, bruno));
    await forbidden(getContact(users.owner.actor, crypto.randomUUID()));
  });

  it("an agent limited to some channels sees only the identities and consents of those channels [PER-02]", async () => {
    await db.insert(contactIdentities).values({ contactId: ana, channelType: "whatsapp", externalId: "ES.bsuid-ana", phone: "34600999888" });
    await db.insert(consents).values([
      { contactId: ana, channelId: channelB, type: "opt_out", source: "BAJA" },
      { contactId: ana, channelId: channelA, type: "legal_acceptance", source: "widget" },
    ]);
    const limited = await getContact(users.agentA.actor, ana);
    expect(limited.identities.map((identity) => identity.channelType)).toEqual(["webchat"]);
    expect(limited.consents.map((consent) => consent.channelName)).toEqual(["Web A"]);
    // The owner, and an agent with every channel, still see everything.
    for (const actor of [users.owner.actor, users.agentAll.actor]) {
      const full = await getContact(actor, ana);
      expect(full.identities).toHaveLength(2);
      expect(full.consents).toHaveLength(2);
    }
  });
});

describe("creating and editing contacts [CTO-01]", () => {
  it("owner, supervisor and agents create and edit; Solo lectura cannot", async () => {
    const { id } = await createContact(users.supervisor.actor, { name: "Carla", phone: "+34 611 000 000", labels: ["nueva", "nueva"], customFields: { alergias: "ninguna" } });
    await updateContact(users.owner.actor, id, { email: "carla@example.com", labels: ["habitual"] });
    const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(row).toMatchObject({ name: "Carla", phone: "+34 611 000 000", email: "carla@example.com", labels: ["habitual"], customFields: { alergias: "ninguna" } });
    await forbidden(createContact(users.viewer.actor, { name: "X" }));
    await forbidden(updateContact(users.viewer.actor, ana, { name: "X" }));
  });

  it("an agent limited to some channels cannot create a contact by hand: it would have no conversation in them [PER-02]", async () => {
    const before = await db.select({ id: contacts.id }).from(contacts);
    await forbidden(createContact(users.agentA.actor, { name: "Dora" }));
    expect(await db.select({ id: contacts.id }).from(contacts)).toHaveLength(before.length);
    // An agent without assigned channels attends every channel, so sees the new contact.
    const { id } = await createContact(users.agentAll.actor, { name: "Dora" });
    expect((await getContact(users.agentAll.actor, id)).name).toBe("Dora");
  });

  it("an agent edits only contacts of their channels", async () => {
    await updateContact(users.agentA.actor, ana, { notes: "Prefiere tardes" });
    await forbidden(updateContact(users.agentA.actor, bruno, { notes: "x" }));
    const [row] = await db.select().from(contacts).where(eq(contacts.id, bruno));
    expect(row.notes).toBeNull();
  });

  it("needs a name, a phone or an email, and valid data", async () => {
    expect(await errorOf(createContact(users.owner.actor, {}))).toBeInstanceOf(ValidationError);
    expect(await errorOf(createContact(users.owner.actor, { email: "no-es-un-email" }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(createContact(users.owner.actor, { name: "X", phone: "abc" }))).toBeInstanceOf(ValidationError);
  });
});
