// «Quitar una baja» ([CTO-08], [CUM-13], [PER-03], [SEG-04], [SEG-05]): only when the customer asks for it, by the
// roles of «Contactos: fusionar duplicados y quitar una baja» (owner, admin, supervisor), recorded as an «alta» with
// who, when and why, and in the activity log. Called directly, as a request would: hiding a button protects nothing.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, channelMembers, channels, consents, contactIdentities, contacts, conversations, messages } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { isOptedOut } from "@/server/compliance/opt-out";
import { actorFor, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { isConversationOptedOut, liftOptOut } from "./consents";

const OPTED_OUT_AT = new Date("2026-09-20T10:00:00Z");

let channelId: string;
let contactId: string;

async function optOut(at = OPTED_OUT_AT) {
  await db.insert(consents).values({ contactId, channelId, channelType: "whatsapp", type: "opt_out", source: "keyword", createdAt: at, updatedAt: at });
}

beforeEach(async () => {
  for (const table of [messages, conversations, consents, contactIdentities, contacts, auditLog, channelMembers]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  channelId = (await createChannel({ type: "whatsapp", name: "WhatsApp" })).id;
  contactId = (await createContactWithIdentity("whatsapp", { name: "Ana" })).contact.id;
});

describe("lifting an opt-out [CTO-08] [CUM-13]", () => {
  it.each<Role>(["owner", "admin", "supervisor"])("%s lifts it: an «alta» in that channel with who, when and why, and the activity log", async (role) => {
    await optOut();
    const person = await createUser(role, { name: "Sara" });
    const { consentId } = await liftOptOut(person.actor, { contactId, channelId, note: "Lo ha pedido por teléfono" });

    expect(await isOptedOut(contactId, channelId)).toBe(false);
    const [alta] = await db.select().from(consents).where(eq(consents.id, consentId));
    expect(alta).toMatchObject({ contactId, channelId, channelType: "whatsapp", type: "opt_in", source: "person", recordedByUserId: person.userId, recordedByName: "Sara", note: "Lo ha pedido por teléfono" });
    expect(alta.createdAt.getTime()).toBeGreaterThan(OPTED_OUT_AT.getTime());

    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ actorType: "user", actorUserId: person.userId, action: "consent.opt_out_lifted", targetType: "contact", targetId: contactId });
    expect(entry.metadata).toEqual({ channelId });
  });

  it("the «alta» is the newest choice even when the baja carries a time ahead of the clock", async () => {
    await optOut(new Date(Date.now() + 60_000));
    const owner = await createUser("owner");
    await liftOptOut(owner.actor, { contactId, channelId });
    expect(await isOptedOut(contactId, channelId)).toBe(false);
  });

  it("only a baja in force can be lifted", async () => {
    const owner = await createUser("owner");
    await expect(liftOptOut(owner.actor, { contactId, channelId })).rejects.toMatchObject({ status: 409 });
    await optOut();
    await liftOptOut(owner.actor, { contactId, channelId });
    await expect(liftOptOut(owner.actor, { contactId, channelId })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(consents)).toHaveLength(2);
  });

  it("a baja of another channel is not this one", async () => {
    await optOut();
    const other = await createChannel({ type: "whatsapp", name: "Otro número" });
    const owner = await createUser("owner");
    await expect(liftOptOut(owner.actor, { contactId, channelId: other.id })).rejects.toMatchObject({ status: 409 });
    expect(await isOptedOut(contactId, channelId)).toBe(true);
  });

  it("an unknown contact is not found", async () => {
    const owner = await createUser("owner");
    await expect(liftOptOut(owner.actor, { contactId: crypto.randomUUID(), channelId })).rejects.toMatchObject({ status: 404 });
  });

  it("checks what it gets [SEG-05]", async () => {
    await optOut();
    const owner = await createUser("owner");
    await expect(liftOptOut(owner.actor, { contactId: "no-es-un-id", channelId })).rejects.toMatchObject({ status: 400 });
    await expect(liftOptOut(owner.actor, { contactId, channelId, note: "x".repeat(301) })).rejects.toMatchObject({
      status: 400,
      fieldErrors: { note: ["Como mucho 300 caracteres."] },
    });
    await expect(liftOptOut(owner.actor, { contactId, channelId, extra: true })).rejects.toMatchObject({ status: 400 });
    expect(await isOptedOut(contactId, channelId)).toBe(true);
  });
});

describe.each<Role>(["agent", "viewer"])("lifting an opt-out as %s [PER-03] [SEG-04]", (role) => {
  it("is refused and nothing changes", async () => {
    await optOut();
    const person = await createUser(role, { channelIds: role === "agent" ? [channelId] : [] });
    await expect(liftOptOut(person.actor, { contactId, channelId })).rejects.toMatchObject({ status: 403 });
    expect(await isOptedOut(contactId, channelId)).toBe(true);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });
});

describe("the inbox warns when the customer opted out of the channel [CUM-03] [CUM-04]", () => {
  it("whoever sees the conversation learns it; once lifted, the warning goes", async () => {
    const conversation = await createConversation(channelId, contactId);
    const owner = await createUser("owner");
    const viewer = await createUser("viewer");
    expect(await isConversationOptedOut(owner.actor, conversation.id)).toBe(false);
    await optOut();
    expect(await isConversationOptedOut(owner.actor, conversation.id)).toBe(true);
    expect(await isConversationOptedOut(viewer.actor, conversation.id)).toBe(true);
    await liftOptOut(owner.actor, { contactId, channelId });
    expect(await isConversationOptedOut(owner.actor, conversation.id)).toBe(false);
  });

  it("[PER-02] an agent of another channel is refused", async () => {
    const conversation = await createConversation(channelId, contactId);
    await expect(isConversationOptedOut(actorFor("agent", { channelIds: [crypto.randomUUID()] }), conversation.id)).rejects.toMatchObject({ status: 403 });
  });

  it("[CUM-03] in an email thread, the one that counts is the sender of the newest email", async () => {
    const mailbox = await createChannel({ type: "email_imap", name: "Correo" });
    const first = await createContactWithIdentity("email_imap", { externalId: "ana@cliente.test" });
    const copied = await createContactWithIdentity("email_imap", { externalId: "luis@otro.test" });
    const conversation = await createConversation(mailbox.id, first.contact.id, { externalThreadId: "hilo" });
    const email = (address: string) => ({ email: { providerId: crypto.randomUUID(), messageId: null, from: { address, name: null } } });
    await createMessage(conversation, { createdAt: new Date("2026-09-27T09:00:00Z"), metadata: email("ana@cliente.test") });
    await createMessage(conversation, { createdAt: new Date("2026-09-27T10:00:00Z"), metadata: email("luis@otro.test") });
    await db.insert(consents).values({ contactId: copied.contact.id, channelId: mailbox.id, channelType: "email_imap", type: "opt_out", source: "keyword" });
    const owner = await createUser("owner");
    expect(await isConversationOptedOut(owner.actor, conversation.id)).toBe(true);
  });
});
