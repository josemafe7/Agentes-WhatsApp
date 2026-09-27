// Vitest fixtures for the data rights of a contact (export, erase and merge, [CTO-05]–[CTO-07]): a contact with
// everything the app can keep about a customer — identities, consents, two conversations with text, an AI reply with
// its sources and usage, a person's reply, a voice note with its stored file and transcript, an internal note, a
// hand-off, a booking with its history, a team notification, a raw webhook and a pending reply job.
import "server-only";
import { db } from "@/db";
import {
  aiRuns,
  appKv,
  auditLog,
  bookingEvents,
  bookings,
  consents,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  internalNotes,
  jobs,
  messageRetrievals,
  messages,
  notifications,
  realtimeEvents,
  systemEmails,
  webhookEvents,
} from "@/db/schema";
import type { FileStorage } from "@/server/adapters/file-storage";
import { getJobQueue } from "@/server/adapters/job-queue";
import { createBooking } from "@/server/booking";
import { at, type createHairdresser, NOW } from "@/server/booking/test-helpers";
import { replyDedupeKey } from "@/server/engine/schedule";
import { createConversation, createMessage } from "@/test/factories";

type Hairdresser = Awaited<ReturnType<typeof createHairdresser>>;
type Channel = { id: string; name: string };

export type RichContactInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  channels: { web: Channel; whatsapp: Channel };
  storage: FileStorage;
  hair: Hairdresser;
  /** Business-local start of its booking ("YYYY-MM-DDTHH:mm"), in the test week of the hairdresser. */
  bookingStart: string;
  /** The team member recorded as author of replies, notes and bookings. */
  person: { userId: string; name: string };
  /** When its conversations started (default: an hour before NOW). */
  since?: Date;
};

const MINUTE_MS = 60_000;

/** Removes every contact and what hangs from them (children first), plus the log, jobs and events around them. */
export async function clearContactData(): Promise<void> {
  for (const table of [
    jobs,
    realtimeEvents,
    appKv,
    webhookEvents,
    systemEmails,
    notifications,
    messageRetrievals,
    aiRuns,
    handoffEvents,
    internalNotes,
    bookingEvents,
    bookings,
    messages,
    conversations,
    consents,
    contactIdentities,
    contacts,
    auditLog,
  ]) {
    await db.delete(table);
  }
}

/** A contact with every kind of data about them; returns the ids and keys the tests look for. */
export async function createRichContact(input: RichContactInput) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const since = input.since ?? new Date(NOW.getTime() - 60 * MINUTE_MS);
  const minute = (n: number) => new Date(since.getTime() + n * MINUTE_MS);
  const phoneDigits = (input.phone ?? "").replace(/\D/g, "") || null;

  const [contact] = await db
    .insert(contacts)
    .values({
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      labels: ["vip"],
      customFields: { alergias: "ninguna" },
      notes: `${input.name} prefiere las mañanas.`,
      createdAt: since,
      updatedAt: since,
    })
    .returning();
  const identities = await db
    .insert(contactIdentities)
    .values([
      { contactId: contact.id, channelType: "webchat", externalId: `visitor-${suffix}`, createdAt: since },
      { contactId: contact.id, channelType: "whatsapp", externalId: `ES.bsuid-${suffix}`, phone: phoneDigits, displayName: input.name, createdAt: minute(1) },
    ])
    .returning();
  await db.insert(consents).values([
    { contactId: contact.id, channelId: input.channels.web.id, channelType: "webchat", type: "legal_acceptance", source: "widget", createdAt: since },
    { contactId: contact.id, channelId: input.channels.whatsapp.id, channelType: "whatsapp", type: "opt_out", source: "BAJA", createdAt: minute(30) },
  ]);

  const web = await createConversation(input.channels.web.id, contact.id, { createdAt: since, lastMessageAt: minute(3), lastInboundAt: minute(1), labels: ["web"] });
  const whatsapp = await createConversation(input.channels.whatsapp.id, contact.id, { createdAt: minute(10), lastMessageAt: minute(20), lastInboundAt: minute(12) });

  const webFirst = await createMessage(web, { text: `Hola, soy ${input.name}. ¿Tenéis cita el lunes?`, createdAt: minute(1), sentAt: minute(1) });
  const aiReply = await createMessage(web, {
    direction: "outbound",
    senderType: "ai",
    agentName: "Recepción",
    externalId: null,
    text: "¡Hola! Sí, el lunes hay huecos por la mañana.",
    status: "sent",
    createdAt: minute(2),
  });
  const run = await db
    .insert(aiRuns)
    .values({ kind: "chat", conversationId: web.id, messageId: aiReply.id, modelRequested: "openai/gpt-5.6-luna", costUsd: 0.0012, createdAt: minute(2) })
    .returning();
  await db.insert(messageRetrievals).values({ messageId: aiReply.id, rank: 1, score: 0.8, title: "Horario", page: 1 });

  const fileKey = `media/2026/09/${crypto.randomUUID()}.ogg`;
  await input.storage.put(fileKey, new Uint8Array([79, 103, 103, 83]), "audio/ogg");
  const voice = await createMessage(whatsapp, {
    contentType: "audio",
    text: null,
    transcript: "Quería cambiar la cita del lunes.",
    media: { fileKey, mimeType: "audio/ogg", size: 4, fileName: "nota-de-voz.ogg", sha256: "abc123", durationSec: 3, downloadStatus: "done" },
    createdAt: minute(12),
    sentAt: minute(12),
  });
  const humanReply = await createMessage(whatsapp, {
    direction: "outbound",
    senderType: "human",
    senderUserId: input.person.userId,
    senderName: input.person.name,
    externalId: `wamid.${suffix}`,
    text: "Te la cambio ahora mismo.",
    status: "delivered",
    createdAt: minute(20),
  });
  const [note] = await db
    .insert(internalNotes)
    .values({ conversationId: whatsapp.id, authorUserId: input.person.userId, authorName: input.person.name, text: `Llamar a ${input.name} si no contesta.`, createdAt: minute(21) })
    .returning();
  const [handoff] = await db
    .insert(handoffEvents)
    .values({
      conversationId: whatsapp.id,
      trigger: "ai_tool",
      reason: "Quiere cambiar la cita",
      summary: `${input.name} pide mover su cita.`,
      urgency: "normal",
      requestedAt: minute(13),
      firstHumanResponseAt: minute(20),
      firstHumanMessageId: humanReply.id,
    })
    .returning();

  const booking = await createBooking({
    serviceId: input.hair.cut.id,
    resourceId: input.hair.laura.id,
    start: at(input.bookingStart),
    contactId: contact.id,
    notes: `${input.name} es alérgica al tinte.`,
    source: "ai",
    channelId: input.channels.whatsapp.id,
    conversationId: whatsapp.id,
    actor: { type: "user", userId: input.person.userId, name: input.person.name },
    now: NOW,
  });

  const [notification] = await db
    .insert(notifications)
    .values({ userId: input.person.userId, event: "handoff", title: `Traspaso: ${input.name}`, link: `/bandeja/${whatsapp.id}`, channelId: input.channels.whatsapp.id })
    .returning();
  const [webhook] = await db
    .insert(webhookEvents)
    .values({
      source: "whatsapp",
      channelId: input.channels.whatsapp.id,
      signatureValid: true,
      payload: { entry: [{ changes: [{ value: { contacts: [{ user_id: `ES.bsuid-${suffix}`, profile: { name: input.name } }] } }] }] },
      receivedAt: minute(12),
    })
    .returning();
  const job = await getJobQueue().enqueue({ type: "reply", payload: { conversationId: whatsapp.id }, dedupeKey: replyDedupeKey(whatsapp.id), runAt: NOW });

  return {
    contact,
    identities,
    conversations: { web, whatsapp },
    messages: { webFirst, aiReply, voice, humanReply },
    aiRunId: run[0].id,
    fileKey,
    noteId: note.id,
    handoffId: handoff.id,
    bookingId: booking.id,
    notificationId: notification.id,
    webhookEventId: webhook.id,
    jobId: job.id,
  };
}
