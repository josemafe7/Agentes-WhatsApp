// Files a person sends from the inbox ([BAN-14], [CAN-14], [SEG-13]): only what the channel takes, checked by content
// and size, stored privately, sent like any reply (so the AI pauses) and never by Solo lectura or other channels.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ storageDir: "" }));
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  let storage: InstanceType<typeof actual.DiskStorage> | undefined;
  return { ...actual, getFileStorage: () => (storage ??= new actual.DiskStorage(state.storageDir)) };
});

import { db } from "@/db";
import { consents, contactIdentities, contacts, conversations, handoffEvents, jobs, messages, notifications, realtimeEvents, userRoles } from "@/db/schema";
import { getFileStorage } from "@/server/adapters/file-storage";
import { AuthError, ValidationError } from "@/server/errors";
import { makePdf, PNG_1X1 } from "@/server/media/test-fixtures";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { canViewMessageMedia, MAX_ATTACHMENT_BYTES, sendHumanAttachment } from "./messages";

let users: Record<"owner" | "agentA" | "viewer", TestUser>;
let webchat: string;
let webchatNoImages: string;
let whatsapp: string;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

async function conversationIn(channelId: string, type: "webchat" | "whatsapp" = "webchat") {
  const { contact } = await createContactWithIdentity(type);
  const conversation = await createConversation(channelId, contact.id);
  await createMessage(conversation, { text: "Hola", createdAt: new Date(Date.now() - 60_000) });
  return conversation;
}
const outbound = (conversationId: string) => db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound")));
const png = () => ({ bytes: PNG_1X1, fileName: "presupuesto.png" });

beforeAll(async () => {
  state.storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-attachments-"));
  await createBusiness({ aiPauseHours: 12 });
  await db.delete(userRoles);
  webchat = (await createChannel({ name: "Web", config: { imagesEnabled: true } })).id;
  webchatNoImages = (await createChannel({ name: "Web sin imágenes", config: { imagesEnabled: false } })).id;
  whatsapp = (await createChannel({ name: "WhatsApp demo", type: "whatsapp", isDemo: true })).id;
  users = {
    owner: await createUser("owner", { name: "Olga" }),
    agentA: await createUser("agent", { name: "Aitor", channelIds: [webchat] }),
    viewer: await createUser("viewer"),
  };
});
afterAll(() => fs.rmSync(state.storageDir, { recursive: true, force: true }));

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents]) await db.delete(table);
});

describe("attachments from the inbox [BAN-14] [CAN-14]", () => {
  it("an image goes out with its text, stored privately, and the AI of the conversation pauses", async () => {
    const conversation = await conversationIn(webchat);
    const sent = await sendHumanAttachment(users.agentA.actor, { conversationId: conversation.id, text: "Te mando el presupuesto" }, png());
    expect(sent.status).toBe("sent");
    expect(sent.aiPausedUntil).not.toBeNull();
    const [message] = await outbound(conversation.id);
    expect(message).toMatchObject({ senderType: "human", senderName: "Aitor", contentType: "image", text: "Te mando el presupuesto" });
    const key = message.media?.fileKey ?? "";
    // Generated key, never the file name; the original name stays only for downloads.
    expect(key).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(message.media).toMatchObject({ mimeType: "image/png", fileName: "presupuesto.png", size: PNG_1X1.byteLength });
    expect(await getFileStorage().exists(key)).toBe(true);
    // Served only to who may see that conversation ([MED-08]).
    expect(await canViewMessageMedia(users.owner.actor, key)).toBe(true);
  });

  it("a PDF goes where the channel takes documents", async () => {
    const conversation = await conversationIn(whatsapp, "whatsapp");
    await sendHumanAttachment(users.owner.actor, { conversationId: conversation.id }, { bytes: makePdf(["Carta de servicios"]), fileName: "carta.pdf" });
    const [message] = await outbound(conversation.id);
    expect(message).toMatchObject({ contentType: "document", text: null, media: { mimeType: "application/pdf", fileName: "carta.pdf" } });
  });

  it("refuses what the channel does not take, files that are not images or PDF by their content, and big ones", async () => {
    const web = await conversationIn(webchat);
    const pdf = { bytes: makePdf(["x"]), fileName: "carta.pdf" };
    expect(await errorOf(sendHumanAttachment(users.owner.actor, { conversationId: web.id }, pdf))).toBeInstanceOf(ValidationError);
    const noImages = await conversationIn(webchatNoImages);
    expect(await errorOf(sendHumanAttachment(users.owner.actor, { conversationId: noImages.id }, png()))).toBeInstanceOf(ValidationError);
    // An SVG (or an HTML page) renamed .png is still refused.
    const svg = { bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), fileName: "foto.png" };
    expect(await errorOf(sendHumanAttachment(users.owner.actor, { conversationId: web.id }, svg))).toBeInstanceOf(ValidationError);
    const big = { bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1), fileName: "grande.png" };
    big.bytes.set(PNG_1X1);
    expect(await errorOf(sendHumanAttachment(users.owner.actor, { conversationId: web.id }, big))).toBeInstanceOf(ValidationError);
    expect(await outbound(web.id)).toHaveLength(0);
    expect(await outbound(noImages.id)).toHaveLength(0);
  });

  it("[CUM-03] [CUM-04] a person can still send a file to a customer who opted out of the channel", async () => {
    const conversation = await conversationIn(webchat);
    await db.insert(consents).values({ contactId: conversation.contactId ?? "", channelId: webchat, channelType: "webchat", type: "opt_out", source: "keyword" });
    const sent = await sendHumanAttachment(users.owner.actor, { conversationId: conversation.id }, png());
    expect(sent.error).toBeNull();
    expect((await outbound(conversation.id)).map((message) => message.contentType)).toEqual(["image"]);
    await db.delete(consents);
  });

  it("Solo lectura and agents of other channels cannot send files [PER-02] [PER-03]", async () => {
    const other = await conversationIn(whatsapp, "whatsapp");
    expect(await errorOf(sendHumanAttachment(users.viewer.actor, { conversationId: other.id }, png()))).toBeInstanceOf(AuthError);
    expect(await errorOf(sendHumanAttachment(users.agentA.actor, { conversationId: other.id }, png()))).toBeInstanceOf(AuthError);
    expect(await outbound(other.id)).toHaveLength(0);
  });
});
