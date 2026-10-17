// «Quitar una baja» ([CTO-08], [CUM-13], [PER-03], [SEG-04], [SEG-05]): only when the customer asks for it, by the
// roles of «Contactos: fusionar duplicados y quitar una baja» (owner, admin, supervisor), recorded as an «alta» with
// who, when and why, and in the activity log. A baja counts for every channel of its kind ([CTO-09]). Called directly,
// as a request would: hiding a button protects nothing.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, businessSettings, channelMembers, channels, consents, contactIdentities, contacts, conversations, messages } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { blockReason, hasPermission } from "@/lib/consents";
import { loadConsentState } from "@/server/compliance/consent-state";
import { isOptedOut } from "@/server/compliance/opt-out";
import { actorFor, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { isConversationOptedOut, liftOptOut, markPermissionForContacts, recordOptOutByRequest, setContactPermission } from "./consents";

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
  it.each<Role>(["owner", "admin", "supervisor"])("%s lifts it: an «alta» in that channel with who, when, how and why, and the activity log", async (role) => {
    await optOut();
    const person = await createUser(role, { name: "Sara" });
    const { consentId } = await liftOptOut(person.actor, { contactId, kind: "whatsapp", scope: "all", method: "other", note: "Lo ha pedido por teléfono" });

    expect(await isOptedOut(contactId, channelId)).toBe(false);
    const [alta] = await db.select().from(consents).where(eq(consents.id, consentId));
    expect(alta).toMatchObject({ contactId, channelKind: "whatsapp", type: "opt_in", source: "person", method: "other", recordedByUserId: person.userId, recordedByName: "Sara", note: "Lo ha pedido por teléfono" });
    expect(alta.createdAt.getTime()).toBeGreaterThan(OPTED_OUT_AT.getTime());

    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ actorType: "user", actorUserId: person.userId, action: "consent.opt_out_lifted", targetType: "contact", targetId: contactId });
    expect(entry.metadata).toEqual({ channelKind: "whatsapp", scope: "all" });
  });

  it("the «alta» is the newest choice even when the baja carries a time ahead of the clock", async () => {
    await optOut(new Date(Date.now() + 60_000));
    const owner = await createUser("owner");
    await liftOptOut(owner.actor, { contactId, kind: "whatsapp", scope: "all" });
    expect(await isOptedOut(contactId, channelId)).toBe(false);
  });

  it("only a baja in force can be lifted", async () => {
    const owner = await createUser("owner");
    await expect(liftOptOut(owner.actor, { contactId, kind: "whatsapp", scope: "all" })).rejects.toMatchObject({ status: 409 });
    await optOut();
    await liftOptOut(owner.actor, { contactId, kind: "whatsapp", scope: "all" });
    await expect(liftOptOut(owner.actor, { contactId, kind: "whatsapp", scope: "all" })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(consents)).toHaveLength(2);
  });

  it("[CTO-09] a baja counts for every number of its kind; one of another kind is not this one", async () => {
    await optOut();
    const other = await createChannel({ type: "whatsapp", name: "Otro número" });
    expect(await isOptedOut(contactId, other.id)).toBe(true);
    const owner = await createUser("owner");
    await expect(liftOptOut(owner.actor, { contactId, kind: "email", scope: "all" })).rejects.toMatchObject({ status: 409 });
    expect(await isOptedOut(contactId, channelId)).toBe(true);
  });

  it("an unknown contact is not found", async () => {
    const owner = await createUser("owner");
    await expect(liftOptOut(owner.actor, { contactId: crypto.randomUUID(), kind: "whatsapp", scope: "all" })).rejects.toMatchObject({ status: 404 });
  });

  it("checks what it gets [SEG-05]", async () => {
    await optOut();
    const owner = await createUser("owner");
    await expect(liftOptOut(owner.actor, { contactId: "no-es-un-id", kind: "whatsapp", scope: "all" })).rejects.toMatchObject({ status: 400 });
    await expect(liftOptOut(owner.actor, { contactId, kind: "whatsapp", scope: "all", note: "x".repeat(301) })).rejects.toMatchObject({
      status: 400,
      fieldErrors: { note: ["Como mucho 300 caracteres."] },
    });
    await expect(liftOptOut(owner.actor, { contactId, kind: "whatsapp", scope: "all", extra: true })).rejects.toMatchObject({ status: 400 });
    expect(await isOptedOut(contactId, channelId)).toBe(true);
  });
});

describe.each<Role>(["agent", "viewer"])("lifting an opt-out as %s [PER-03] [SEG-04]", (role) => {
  it("is refused and nothing changes", async () => {
    await optOut();
    const person = await createUser(role, { channelIds: role === "agent" ? [channelId] : [] });
    await expect(liftOptOut(person.actor, { contactId, kind: "whatsapp", scope: "all" })).rejects.toMatchObject({ status: 403 });
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
    await liftOptOut(owner.actor, { contactId, kind: "whatsapp", scope: "all" });
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

describe("marking a permission [CTO-09] [CUM-13]", () => {
  it("records it with who, when, how and the date the customer gave it, and the activity log", async () => {
    const person = await createUser("supervisor", { name: "Olga" });
    await setContactPermission(person.actor, { contactId, permission: "reminders", granted: true, method: "in_person", givenOn: "2026-09-01", note: "En recepción" });
    const [row] = await db.select().from(consents);
    expect(row).toMatchObject({ type: "reminders_granted", source: "person", method: "in_person", actorType: "user", recordedByName: "Olga", note: "En recepción", channelKind: null });
    expect(row.givenAt?.toISOString().slice(0, 10)).toBe("2026-09-01");
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ action: "consent.permission_changed", targetId: contactId });
    expect(entry.metadata).toEqual({ permission: "reminders", granted: true, how: "in_person" });
    expect(hasPermission(await loadConsentState(contactId), "reminders")).toBe(true);

    await setContactPermission(person.actor, { contactId, permission: "reminders", granted: false, method: "written" });
    expect(hasPermission(await loadConsentState(contactId), "reminders")).toBe(false);
  });

  it("[SEG-05] needs how it was given, and never a date in the future", async () => {
    const owner = await createUser("owner");
    await expect(setContactPermission(owner.actor, { contactId, permission: "marketing", granted: true })).rejects.toMatchObject({ status: 400 });
    await expect(setContactPermission(owner.actor, { contactId, permission: "marketing", granted: true, method: "web", givenOn: "2999-01-01" })).rejects.toMatchObject({
      status: 400,
      fieldErrors: { givenOn: ["La fecha no puede ser futura."] },
    });
    expect(await db.select().from(consents)).toHaveLength(0);
  });

  it("today is today in the business's time zone: at 00:30 in Madrid, that date is not in the future", async () => {
    const owner = await createUser("owner");
    await db.update(businessSettings).set({ timezone: "Europe/Madrid" });
    vi.useFakeTimers({ toFake: ["Date"] });
    // 22:30 UTC of the 15th is 00:30 of the 16th in Madrid (summer time).
    vi.setSystemTime(new Date("2026-10-15T22:30:00Z"));
    try {
      await setContactPermission(owner.actor, { contactId, permission: "reminders", granted: true, method: "in_person", givenOn: "2026-10-16" });
      await expect(setContactPermission(owner.actor, { contactId, permission: "reminders", granted: true, method: "in_person", givenOn: "2026-10-17" })).rejects.toMatchObject({
        fieldErrors: { givenOn: ["La fecha no puede ser futura."] },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("[PER-02] an agent marks it on the contacts of their channels only; Solo lectura never [SEG-04]", async () => {
    await createConversation(channelId, contactId);
    const own = await createUser("agent", { channelIds: [channelId] });
    await setContactPermission(own.actor, { contactId, permission: "reminders", granted: true, method: "conversation" });
    const otherChannel = await createChannel({ type: "webchat", name: "Web" });
    const stranger = await createUser("agent", { channelIds: [otherChannel.id] });
    await expect(setContactPermission(stranger.actor, { contactId, permission: "marketing", granted: true, method: "web" })).rejects.toMatchObject({ status: 403 });
    const viewer = await createUser("viewer");
    await expect(setContactPermission(viewer.actor, { contactId, permission: "marketing", granted: true, method: "web" })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(consents)).toHaveLength(1);
  });
});

describe("a baja the customer asks for by another way [CTO-10]", () => {
  it("for every channel, of everything: one record per kind, the AI stops on all of them, and no message goes", async () => {
    const owner = await createUser("owner", { name: "Sara" });
    const { kinds } = await recordOptOutByRequest(owner.actor, { contactId, kind: "all", scope: "all", method: "in_person" });
    expect(kinds.sort()).toEqual(["email", "instagram", "telegram", "webchat", "whatsapp"]);
    const state = await loadConsentState(contactId);
    for (const kind of kinds) expect(blockReason(state, kind, "conversation")).toBe("opted_out");
    expect(await db.select().from(messages)).toHaveLength(0);
    const [entry] = await db.select().from(auditLog);
    expect(entry.metadata).toMatchObject({ scope: "all", source: "person" });
  });

  it("of novedades y publicidad on one channel: the reminders and the AI go on; recording it again changes nothing", async () => {
    const owner = await createUser("owner");
    await setContactPermission(owner.actor, { contactId, permission: "reminders", granted: true, method: "in_person" });
    await recordOptOutByRequest(owner.actor, { contactId, kind: "whatsapp", scope: "marketing", method: "other", note: "Por teléfono" });
    const state = await loadConsentState(contactId);
    expect(blockReason(state, "whatsapp", "marketing")).toBe("marketing_opted_out");
    expect(blockReason(state, "whatsapp", "reminder")).toBeNull();
    expect(blockReason(state, "email", "marketing")).toBe("no_marketing_permission");
    expect((await recordOptOutByRequest(owner.actor, { contactId, kind: "whatsapp", scope: "marketing", method: "other" })).kinds).toEqual([]);
  });

  it("[PER-01] Solo lectura may not", async () => {
    const viewer = await createUser("viewer");
    await expect(recordOptOutByRequest(viewer.actor, { contactId, kind: "all", scope: "all", method: "in_person" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("marking a permission on several contacts at once [CTO-09] [CTO-10]", () => {
  it("marks it on each one, skips and lists whoever has a baja, and leaves alone whoever had it", async () => {
    const owner = await createUser("owner", { name: "Sara" });
    const second = (await createContactWithIdentity("whatsapp", { name: "Luis" })).contact.id;
    const optedOut = (await createContactWithIdentity("whatsapp", { name: "Marta" })).contact.id;
    await db.insert(consents).values({ contactId: optedOut, channelKind: "telegram", type: "opt_out", source: "person" });
    await setContactPermission(owner.actor, { contactId: second, permission: "marketing", granted: true, method: "web" });
    await db.delete(auditLog);

    const result = await markPermissionForContacts(owner.actor, { ids: [contactId, second, optedOut], permission: "marketing", method: "written", confirmed: true });
    expect(result).toEqual({ marked: 1, already: 1, skipped: [{ id: optedOut, displayName: "Marta", reason: "Dado de baja en Telegram" }] });
    expect(hasPermission(await loadConsentState(contactId), "marketing")).toBe(true);
    expect(hasPermission(await loadConsentState(optedOut), "marketing")).toBe(false);
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ action: "consents.permissions_marked" });
    expect(entry.metadata).toEqual({ permission: "marketing", how: "written", marked: 1, already: 1, skipped: 1 });
  });

  it("[SEG-05] only once the person confirms they gave it", async () => {
    const owner = await createUser("owner");
    await expect(markPermissionForContacts(owner.actor, { ids: [contactId], permission: "reminders", method: "written" })).rejects.toMatchObject({ status: 400 });
    expect(await db.select().from(consents)).toHaveLength(0);
  });

  it("[PER-02] an agent marks only the contacts of their channels; Solo lectura none", async () => {
    await createConversation(channelId, contactId);
    const stranger = (await createContactWithIdentity("whatsapp", { name: "Otro" })).contact.id;
    const agent = await createUser("agent", { channelIds: [channelId] });
    expect((await markPermissionForContacts(agent.actor, { ids: [contactId, stranger], permission: "reminders", method: "in_person", confirmed: true })).marked).toBe(1);
    expect(hasPermission(await loadConsentState(stranger), "reminders")).toBe(false);
    const viewer = await createUser("viewer");
    await expect(markPermissionForContacts(viewer.actor, { ids: [contactId], permission: "reminders", method: "in_person", confirmed: true })).rejects.toMatchObject({ status: 403 });
  });
});
