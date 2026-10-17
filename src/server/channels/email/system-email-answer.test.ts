// An answer to a reminder that went by the system mail ([AGD-24], [AGD-26]): the reminder carries a Message-ID of its
// own, kept with the contact and the booking it was for; an answer that reaches a connected mailbox (In-Reply-To or
// References) goes to that contact's conversation. A sender the receiving server vouched for gets the address as an
// identity «sin confirmar» ([WA-63]); one it did not, none (the next email of that address starts its own contact).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, messages, systemEmails } from "@/db/schema";
import { sendSystemEmail } from "@/server/mailer";
import { eraseContact } from "@/data/contacts-erase";
import { mergeContacts } from "@/data/contacts-merge";
import { createBusiness, createChannel, createUser } from "@/test/factories";
import type { ChannelRecord } from "../types";
import { ingestInboundEmail } from "./ingest";
import { parseRawEmail } from "./parse";
import { buildRawEmail, verifiedEmail } from "./test-helpers";

const NOW = new Date("2026-09-30T09:00:00Z");
const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-answer-"));
afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

let mailbox: ChannelRecord;
let contactId: string;

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, systemEmails]) await db.delete(table);
  await db.delete(contacts);
  await db.delete(channels);
  await createBusiness();
  mailbox = await createChannel({ type: "email_imap", name: "Buzón", status: "connected" });
  [{ id: contactId }] = await db.insert(contacts).values({ name: "Rosa", email: "rosa@cliente.test" }).returning({ id: contacts.id });
});

async function sentReminder(): Promise<string> {
  const result = await sendSystemEmail(
    { kind: "reminder", to: "rosa@cliente.test", subject: "Tu cita", text: "Te esperamos.", recipient: { contactId, bookingId: "b-1" } },
    { outboxDir, smtp: null },
  );
  expect(result.ok).toBe(true);
  const [row] = await db.select().from(systemEmails);
  expect(row).toMatchObject({ kind: "reminder", contactId, bookingId: "b-1", messageId: expect.stringMatching(/^<[0-9a-f-]{36}@localhost>$/) });
  // The .eml carries that same Message-ID.
  expect(fs.readFileSync(path.join(outboxDir, row.outboxFile ?? ""), "utf8")).toContain(`Message-ID: ${row.messageId}`);
  return row.messageId ?? "";
}

async function receive(raw: Buffer) {
  const email = { providerId: `p-${crypto.randomUUID()}`, threadId: `t-${crypto.randomUUID()}`, parsed: await parseRawEmail(raw), receivedAt: NOW };
  const outcome = await ingestInboundEmail(mailbox, email, { now: NOW });
  if (outcome.kind !== "ingested") throw new Error("El correo no se ha guardado");
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, outcome.conversationId));
  return conversation;
}

describe("an answer to a reminder of the system mail [AGD-24] [AGD-26]", () => {
  it("from a vouched sender: it goes to the contact, whose address becomes an identity «sin confirmar»", async () => {
    const messageId = await sentReminder();
    const conversation = await receive(await verifiedEmail({ from: "rosa@cliente.test", inReplyTo: messageId, references: [messageId], text: "No puedo ir, ¿la cambiamos?" }));
    expect(conversation.contactId).toBe(contactId);
    expect(await db.select().from(contacts)).toHaveLength(1);
    expect(await db.select().from(contactIdentities)).toEqual([expect.objectContaining({ contactId, channelType: "email_imap", externalId: "rosa@cliente.test", unconfirmedSince: NOW })]);
  });

  it("from a sender nobody vouched for: it goes to the contact but gives no identity", async () => {
    const messageId = await sentReminder();
    const conversation = await receive(await buildRawEmail({ from: "rosa@cliente.test", inReplyTo: messageId, text: "No puedo ir" }));
    expect(conversation.contactId).toBe(contactId);
    expect(await db.select().from(contactIdentities)).toEqual([]);
  });

  it("[CTO-05] [CTO-07] after a merge it reaches the kept contact; an erased contact leaves nothing of it in the log", async () => {
    const messageId = await sentReminder();
    const owner = await createUser("owner", { name: "Elena" });
    const [kept] = await db.insert(contacts).values({ name: "Rosa Pérez", email: "rosa.perez@cliente.test" }).returning();
    await mergeContacts(owner.actor, { keepId: kept.id, mergeId: contactId });
    const conversation = await receive(await verifiedEmail({ from: "rosa@cliente.test", inReplyTo: messageId, text: "Gracias" }));
    expect(conversation.contactId).toBe(kept.id);
    await eraseContact(owner.actor, kept.id, { confirmName: "Rosa Pérez" });
    expect(await db.select().from(systemEmails)).toEqual([]);
  });

  it("an email that answers nothing of ours starts its own contact, as always", async () => {
    await sentReminder();
    const conversation = await receive(await verifiedEmail({ from: "rosa@cliente.test", inReplyTo: "<otro@cliente.test>" }));
    expect(conversation.contactId).not.toBe(contactId);
    expect((await db.select().from(contactIdentities))[0]).toMatchObject({ externalId: "rosa@cliente.test", unconfirmedSince: null });
  });
});
