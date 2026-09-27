// The rules of a merge, without a database ([CTO-04], [CTO-05], [CAN-12]).
import { describe, expect, it } from "vitest";
import type { conversations } from "@/db/schema";
import { conversationFolds, defaultChoices, emailKey, foldedConversation, mergedValues, nameKey, phoneKey, type MergeableContact } from "./contacts-merge-plan";

const contact = (overrides: Partial<MergeableContact> = {}): MergeableContact => ({ name: null, phone: null, email: null, notes: null, labels: [], customFields: {}, ...overrides });

describe("qué datos se quedan al fusionar [CTO-05]", () => {
  const keep = contact({ name: "José Pérez", email: "jose@example.com", notes: "Prefiere las mañanas.", labels: ["vip"], customFields: { alergias: "ninguna" } });
  const merge = contact({ name: "Jose", phone: "600 111 222", email: "jose@example.com", notes: "Viene con su hija.", labels: ["habitual", "vip"], customFields: { alergias: "polen", cumpleaños: "3 de mayo" } });

  it("by default keeps the kept contact's values, fills its blanks with the other's and keeps both notes", () => {
    expect(defaultChoices(keep, merge)).toEqual({ name: "keep", phone: "merge", email: "keep", notes: "both" });
    const { values, conflicts } = mergedValues(keep, merge);
    expect(values).toMatchObject({ name: "José Pérez", phone: "600 111 222", email: "jose@example.com", notes: "Prefiere las mañanas.\n\nViene con su hija." });
    expect(conflicts).toEqual(["name", "notes"]);
  });

  it("the person may choose the other contact's value field by field", () => {
    const { values } = mergedValues(keep, merge, { name: "merge", notes: "keep" });
    expect(values).toMatchObject({ name: "Jose", notes: "Prefiere las mañanas." });
  });

  it("adds up labels and custom fields; a field of the other contact that clashes is shown as discarded", () => {
    const result = mergedValues(keep, merge);
    expect(result.values.labels).toEqual(["vip", "habitual"]);
    expect(result.labelsAdded).toEqual(["habitual"]);
    expect(result.values.customFields).toEqual({ alergias: "ninguna", cumpleaños: "3 de mayo" });
    expect(result.fieldsAdded).toEqual(["cumpleaños"]);
    expect(result.discardedFields).toEqual([{ field: "alergias", value: "polen" }]);
  });

  it("never goes over the limits of a contact edited by hand", () => {
    const many = (prefix: string, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, "x"]));
    const result = mergedValues(contact({ customFields: many("a", 29), labels: Array.from({ length: 19 }, (_, i) => `k${i}`) }), contact({ customFields: many("b", 3), labels: ["m1", "m2"] }));
    expect(Object.keys(result.values.customFields)).toHaveLength(30);
    expect(result.discardedFields.map((item) => item.field)).toEqual(["b1", "b2"]);
    expect(result.values.labels).toHaveLength(20);
  });
});

describe("qué conversaciones se unen [CTO-05] [CAN-12]", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute));
  const candidates = [
    { id: "k-web", contactId: "keep", channelId: "web", channelType: "webchat" as const, createdAt: at(5) },
    { id: "m-web", contactId: "merge", channelId: "web", channelType: "webchat" as const, createdAt: at(1) },
    { id: "k-wa", contactId: "keep", channelId: "wa", channelType: "whatsapp" as const, createdAt: at(2) },
    { id: "m-mail-1", contactId: "merge", channelId: "mail", channelType: "email_imap" as const, createdAt: at(3) },
    { id: "k-mail-2", contactId: "keep", channelId: "mail", channelType: "email_imap" as const, createdAt: at(4) },
  ];

  it("both in the same web chat, WhatsApp or Telegram channel become one: the oldest stays", () => {
    expect(conversationFolds(candidates, "keep", "merge")).toEqual([{ targetId: "m-web", sourceIds: ["k-web"] }]);
  });

  it("email keeps one conversation per thread, and a channel of only one of them changes nothing", () => {
    expect(conversationFolds(candidates.filter((candidate) => candidate.channelId !== "web"), "keep", "merge")).toEqual([]);
  });

  it("the joined conversation keeps the most urgent state, all unread messages and labels, and starts its summary again", () => {
    const row = (overrides: Partial<typeof conversations.$inferSelect>): typeof conversations.$inferSelect => ({
      id: "x",
      channelId: "web",
      contactId: "keep",
      externalThreadId: null,
      status: "open",
      aiMode: "ai",
      aiPausedUntil: null,
      pauseReason: null,
      assignedUserId: null,
      agentOverrideId: null,
      lastInboundAt: at(1),
      lastOutboundAt: null,
      lastMessageAt: at(1),
      unreadCount: 0,
      labels: [],
      summary: "Resumen antiguo",
      isTest: false,
      metadata: { summaryUntil: "m1" },
      createdAt: at(0),
      updatedAt: at(0),
      ...overrides,
    });
    const folded = foldedConversation(row({ unreadCount: 1, labels: ["web"], status: "resolved" }), [
      row({ status: "pending_human", aiMode: "human", pauseReason: "Traspaso a una persona", unreadCount: 2, labels: ["urgente"], lastMessageAt: at(9), assignedUserId: "u1", metadata: { summaryUntil: "m9", simulated: true } }),
    ]);
    expect(folded).toMatchObject({ status: "pending_human", aiMode: "human", pauseReason: "Traspaso a una persona", unreadCount: 3, labels: ["web", "urgente"], lastMessageAt: at(9), assignedUserId: "u1", summary: null });
    expect(folded.metadata).toEqual({ simulated: true });
  });
});

describe("posibles duplicados [CTO-04]", () => {
  it("compares emails without case, phones by their last nine digits and full names without accents", () => {
    expect(emailKey(" Jose@Example.com ")).toBe("jose@example.com");
    expect(phoneKey("+34 600 111 222")).toBe(phoneKey("600111222"));
    expect(phoneKey("123")).toBeNull();
    expect(nameKey("José  Pérez")).toBe(nameKey("jose perez"));
    // A lone first name is too common to suggest anything.
    expect(nameKey("Ana")).toBeNull();
  });
});
