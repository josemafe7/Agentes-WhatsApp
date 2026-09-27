// Search without accents in the text of the messages of the Bandeja ([BAN-02]): every write of a message's text keeps
// its search text, retention and erasing a contact leave no copy of it ([CUM-05], [CTO-07]), and the messages from
// before the column get it once.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listConversations } from "@/data/conversations";
import { db } from "@/db";
import { appKv, businessSettings, contactIdentities, contacts, conversations, DEFAULT_RETENTION, messages } from "@/db/schema";
import { eraseContactData } from "@/server/compliance/contact-data-erase";
import { runRetention } from "@/server/compliance/retention";
import { sendDraft, sendOutbound } from "@/server/outbound/send";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import type { ChannelRecord } from "@/server/channels/types";
import { ingestEvents } from "./ingest";
import { backfillMessageSearchText, MESSAGE_SEARCH_BACKFILL_KEY, messageSearchText } from "./message-search";

let owner: TestUser;
let agentOfOtherChannel: TestUser;
let web: ChannelRecord;

beforeAll(async () => {
  await createBusiness();
  web = await createChannel({ type: "webchat", name: "Chat de la web" });
  const other = await createChannel({ type: "webchat", name: "Otro chat" });
  owner = await createUser("owner");
  agentOfOtherChannel = await createUser("agent", { channelIds: [other.id] });
});

beforeEach(async () => {
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(contactIdentities);
  await db.delete(contacts);
  await db.delete(appKv).where(eq(appKv.key, MESSAGE_SEARCH_BACKFILL_KEY));
});

const found = async (search: string, actor = owner.actor) => (await listConversations(actor, { search })).items.map((item) => item.id);
const searchTextOf = async (id: string) => (await db.select({ searchText: messages.searchText }).from(messages).where(eq(messages.id, id)))[0]?.searchText;

async function customerWrites(text: string, visitor = `visitante-${crypto.randomUUID()}`) {
  const { conversationId, messageId } = (await ingestEvents(web, [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: [visitor] }, contentType: "text", text, sentAt: new Date() }])).messages[0];
  return { conversationId: conversationId ?? "", messageId: messageId ?? "" };
}

describe("el texto de búsqueda de un mensaje [BAN-02]", () => {
  it("is its text in lower case and without accents", () => {
    expect(messageSearchText("¿Puedo pedir la CANCELACIÓN de mi cita del miércoles?")).toBe("¿puedo pedir la cancelacion de mi cita del miercoles?");
    expect(messageSearchText("  ")).toBeNull();
    expect(messageSearchText(null)).toBeNull();
  });
});

describe("buscar sin tildes en el texto de los mensajes de la Bandeja [BAN-02]", () => {
  it("«cancelacion» finds what the customer wrote as «cancelación», only within the channels the person sees [PER-02]", async () => {
    const { conversationId, messageId } = await customerWrites("Quiero la cancelación de la cita del miércoles");
    expect(await searchTextOf(messageId)).toBe("quiero la cancelacion de la cita del miercoles");
    for (const search of ["cancelacion", "CANCELACIÓN", "miercoles", "Miércoles"]) expect(await found(search)).toEqual([conversationId]);
    expect(await found("reserva")).toEqual([]);
    expect(await found("cancelacion", agentOfOtherChannel.actor)).toEqual([]);
  });

  it("finds what the business sent, and the text a person edited before approving a draft", async () => {
    const { conversationId } = await customerWrites("Hola");
    await sendOutbound({ conversationId, sender: { type: "human", userId: owner.userId, name: owner.name }, text: "Te esperamos el sábado", retryDelayMs: 0 });
    expect(await found("sabado")).toEqual([conversationId]);

    const agent = await createAgentRow({ name: "Recepción" });
    const draft = await sendOutbound({ conversationId, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Borrador sin corregir", draft: true });
    expect(await found("sin corregir")).toEqual([conversationId]);
    await sendDraft(draft.messageId, { text: "Texto corregido por María José", approvedBy: { userId: owner.userId, name: owner.name }, retryDelayMs: 0 });
    expect(await searchTextOf(draft.messageId)).toBe("texto corregido por maria jose");
    expect(await found("sin corregir")).toEqual([]);
    expect(await found("maria jose")).toEqual([conversationId]);
  });
});

describe("ninguna copia del texto sobrevive [CUM-05] [CTO-07]", () => {
  it("anonymizing old messages clears their search text with their text", async () => {
    const now = new Date();
    await db.update(businessSettings).set({ retention: { ...DEFAULT_RETENTION, mode: "anonymize" } });
    const { conversationId, messageId } = await customerWrites("Mi DNI es 12345678Z y me llamo Íñigo");
    await db.update(messages).set({ createdAt: new Date(now.getTime() - 400 * 24 * 60 * 60_000) }).where(eq(messages.id, messageId));
    const { counts } = await runRetention({ now, storage: memoryFileStorage().storage, remainingMs: () => 60_000 });
    expect(counts.messagesAnonymized).toBe(1);
    expect(await db.select({ text: messages.text, searchText: messages.searchText }).from(messages).where(eq(messages.id, messageId))).toEqual([{ text: null, searchText: null }]);
    expect(await found("inigo")).toEqual([]);
    expect(conversationId).not.toBe("");
    await db.update(businessSettings).set({ retention: DEFAULT_RETENTION });
  });

  it("erasing a contact deletes their messages, search text included", async () => {
    const { contact } = await createContactWithIdentity("webchat", { name: "Íñigo", externalId: "visitante-borrado" });
    await createConversation(web.id, contact.id);
    const { messageId } = await customerWrites("Mi teléfono es el 600 111 222", "visitante-borrado");
    await eraseContactData(contact.id, { audit: { actor: owner.actor, action: "contact.erased", targetType: "contact", targetId: contact.id }, storage: memoryFileStorage().storage });
    expect(await db.select().from(messages).where(eq(messages.id, messageId))).toEqual([]);
    expect(await found("telefono")).toEqual([]);
  });
});

describe("los mensajes de antes de la búsqueda sin tildes", () => {
  it("are still found by their exact text, and without accents once the one-time backfill fills them", async () => {
    const { conversationId, messageId } = await customerWrites("La depilación del jueves");
    await db.update(messages).set({ searchText: null }).where(eq(messages.id, messageId));
    const before = (await db.select({ updatedAt: messages.updatedAt }).from(messages).where(eq(messages.id, messageId)))[0].updatedAt;
    expect(await found("depilación")).toEqual([conversationId]);
    expect(await found("depilacion")).toEqual([]);

    expect(await backfillMessageSearchText()).toEqual({ updated: 1, skipped: false });
    expect(await found("depilacion")).toEqual([conversationId]);
    // It does not change when the message was last updated.
    expect((await db.select({ updatedAt: messages.updatedAt }).from(messages).where(eq(messages.id, messageId)))[0].updatedAt).toEqual(before);
    // Once per database.
    expect(await backfillMessageSearchText()).toEqual({ updated: 0, skipped: true });
  });
});
