// Server Actions of the email thread ([BAN-09], [BAN-11], [BAN-14], [COR-14], [COR-19], [SEG-04], [PER-02], [PER-03]):
// the session and the area permission here, the data layer checks the conversation's channel again. A demo mailbox, so
// nothing leaves the app.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/permissions";

const state = vi.hoisted(() => ({ actor: null as Actor | null, refreshes: 0, storageDir: "" }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  return {
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      if (!state.actor) throw new AuthError("unauthenticated");
      if (!can(state.actor, action)) throw new AuthError("forbidden");
      return state.actor;
    },
  };
});
vi.mock("next/cache", () => ({
  refresh: () => {
    state.refreshes++;
  },
}));
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  let storage: InstanceType<typeof actual.DiskStorage> | undefined;
  return { ...actual, getFileStorage: () => (storage ??= new actual.DiskStorage(state.storageDir)) };
});

import { db } from "@/db";
import { messages } from "@/db/schema";
import { makePdf } from "@/server/media/test-fixtures";
import { actorFor, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { discardEmailDraftAction, loadEmailDetailsAction, loadQuotedTextAction, sendEmailAttachmentAction, sendEmailReplyAction } from "./actions";

const REFUSED = { ok: false, error: "No tienes permiso para hacer esto." };
let channelId: string;

beforeAll(async () => {
  state.storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-email-actions-"));
  await createBusiness();
  channelId = (await createChannel({ type: "email_gmail", name: "Correo demo", isDemo: true, replyMode: "draft", config: { emailAddress: "hola@negocio.test", signature: "Peluquería" } })).id;
});
afterAll(() => fs.rmSync(state.storageDir, { recursive: true, force: true }));

let conversationId: string;
let emailId: string;

beforeEach(async () => {
  state.actor = null;
  state.refreshes = 0;
  const { contact } = await createContactWithIdentity("email_gmail", { email: "ana@cliente.test", externalId: `ana-${crypto.randomUUID()}@cliente.test` });
  const conversation = await createConversation(channelId, contact.id, { metadata: { subject: "Cita" } });
  conversationId = conversation.id;
  const email = await createMessage(conversation, {
    text: "Asunto: Cita\n\n¿Hay hueco?",
    metadata: {
      subject: "Cita",
      email: { providerId: crypto.randomUUID(), messageId: "<c@cliente.test>", from: { address: "ana@cliente.test", name: "Ana" }, quotedRemoved: true, originalText: "¿Hay hueco?\n> anterior" },
    },
  });
  emailId = email.id;
});

const outbound = () => db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound")));

describe("sendEmailReplyAction [BAN-11] [COR-21] [PER-02] [PER-03]", () => {
  it("an agent of the channel replies: sent with the signature, the AI paused and the screen refreshed", async () => {
    state.actor = (await createUser("agent", { channelIds: [channelId] })).actor;
    const result = await sendEmailReplyAction({ conversationId, text: "Sí, el martes a las 10." });
    expect(result).toMatchObject({ ok: true, data: { status: "sent", aiPausedUntil: expect.any(Date) } });
    expect(state.refreshes).toBe(1);
    const [message] = await outbound();
    expect(message.text).toBe("Sí, el martes a las 10.\n\n-- \nPeluquería");
  });

  it("Solo lectura, an agent of another channel and nobody are refused, and nothing is stored", async () => {
    state.actor = actorFor("viewer");
    expect(await sendEmailReplyAction({ conversationId, text: "Hola" })).toEqual(REFUSED);
    state.actor = actorFor("agent", { channelIds: [crypto.randomUUID()] });
    expect(await sendEmailReplyAction({ conversationId, text: "Hola" })).toEqual(REFUSED);
    state.actor = null;
    expect(await sendEmailReplyAction({ conversationId, text: "Hola" })).toMatchObject({ ok: false });
    expect(await outbound()).toHaveLength(0);
    expect(state.refreshes).toBe(0);
  });

  it("an empty text comes back as a field error, without sending", async () => {
    state.actor = actorFor("owner");
    expect(await sendEmailReplyAction({ conversationId, text: "  " })).toMatchObject({ ok: false, fieldErrors: { text: expect.any(Array) } });
    expect(await sendEmailReplyAction({ conversationId, text: "Hola", extra: true })).toMatchObject({ ok: false });
    expect(await outbound()).toHaveLength(0);
  });
});

describe("sendEmailAttachmentAction [BAN-14] [SEG-13]", () => {
  const form = (fields: Record<string, string | Blob>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it("a PDF goes with its text and the signature", async () => {
    state.actor = (await createUser("supervisor")).actor;
    const file = new File([new Uint8Array(makePdf(["Precios"]))], "precios.pdf", { type: "application/pdf" });
    const result = await sendEmailAttachmentAction(form({ conversationId, text: "Te mando los precios", file }));
    expect(result).toMatchObject({ ok: true, data: { status: "sent" } });
    const [message] = await outbound();
    expect(message).toMatchObject({ contentType: "document", text: "Te mando los precios\n\n-- \nPeluquería" });
  });

  it("without a file, or with one too big, it says so on the file field; Solo lectura is refused before reading it", async () => {
    state.actor = actorFor("owner");
    expect(await sendEmailAttachmentAction(form({ conversationId }))).toMatchObject({ ok: false, fieldErrors: { file: expect.any(Array) } });
    const big = new File([new Uint8Array(3.5 * 1024 * 1024 + 1)], "grande.pdf", { type: "application/pdf" });
    expect(await sendEmailAttachmentAction(form({ conversationId, file: big }))).toMatchObject({ ok: false, fieldErrors: { file: expect.any(Array) } });
    state.actor = actorFor("viewer");
    expect(await sendEmailAttachmentAction(form({ conversationId, file: new File([new Uint8Array(makePdf(["x"]))], "x.pdf") }))).toEqual(REFUSED);
    expect(await outbound()).toHaveLength(0);
  });
});

describe("discardEmailDraftAction [COR-14] [PER-03]", () => {
  it("the channel's agent discards the AI's draft; Solo lectura cannot", async () => {
    const draft = await createMessage({ id: conversationId, channelId }, { direction: "outbound", senderType: "ai", status: "draft", externalId: null, text: "Borrador" });
    state.actor = actorFor("viewer");
    expect(await discardEmailDraftAction({ messageId: draft.id })).toEqual(REFUSED);
    expect(await outbound()).toHaveLength(1);
    state.actor = (await createUser("agent", { channelIds: [channelId] })).actor;
    expect(await discardEmailDraftAction({ messageId: draft.id })).toEqual({ ok: true });
    expect(await outbound()).toHaveLength(0);
    expect(state.refreshes).toBe(1);
    expect(await discardEmailDraftAction({ messageId: "x" })).toMatchObject({ ok: false });
  });
});

describe("reading the thread [BAN-09] [COR-19] [PER-02]", () => {
  it("Solo lectura reads the emails' details and their quoted text; an agent of another channel does not", async () => {
    state.actor = actorFor("viewer");
    const details = await loadEmailDetailsAction({ conversationId, messageIds: [emailId] });
    expect(details).toMatchObject({ ok: true, data: { [emailId]: { from: { address: "ana@cliente.test", name: "Ana" }, quoted: true } } });
    expect(await loadQuotedTextAction({ messageId: emailId })).toEqual({ ok: true, data: { kind: "quoted", text: "> anterior" } });
    expect(state.refreshes).toBe(0);

    state.actor = actorFor("agent", { channelIds: [crypto.randomUUID()] });
    expect(await loadEmailDetailsAction({ conversationId, messageIds: [emailId] })).toEqual(REFUSED);
    expect(await loadQuotedTextAction({ messageId: emailId })).toEqual(REFUSED);
  });

  it("bad input is refused without reading anything", async () => {
    state.actor = actorFor("owner");
    expect(await loadEmailDetailsAction({ conversationId, messageIds: ["x"] })).toMatchObject({ ok: false });
    expect(await loadQuotedTextAction({ messageId: 3 })).toMatchObject({ ok: false });
  });
});
