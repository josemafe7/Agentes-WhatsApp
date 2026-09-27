// Counters of an email channel's panel ([COR-14], [COR-16], [CAN-01]): received emails, sent ones and drafts waiting for
// a person, per channel. «Canales: ver» (owner, admin, Solo lectura) ([PER-03], [PER-04], [SEG-04]).
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/enums";
import { AuthError, NotFoundError } from "@/server/errors";
import { actorFor, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { getEmailChannelCounters } from "./email-panel";

async function mailbox(overrides: Parameters<typeof createChannel>[0] = {}) {
  await createBusiness();
  const channel = await createChannel({ type: "email_gmail", name: "Gmail", ...overrides });
  // Tests of a file share one database: each mailbox gets its own customer.
  const address = `ana-${crypto.randomUUID().slice(0, 8)}@cliente.test`;
  const { contact } = await createContactWithIdentity("email_gmail", { email: address, externalId: address });
  const conversation = await createConversation(channel.id, contact.id);
  return { channel, conversation };
}

describe("[COR-14] [COR-16] contadores del buzón", () => {
  it("cuenta los correos recibidos (sin sus adjuntos), los enviados y los borradores pendientes", async () => {
    const { channel, conversation } = await mailbox();
    // Two received emails, one with an attachment stored as its own message.
    await createMessage(conversation, { contentType: "text", text: "Asunto: Cita\n\nHola" });
    await createMessage(conversation, { contentType: "text", text: "¿Y el jueves?" });
    await createMessage(conversation, { contentType: "document", text: null, metadata: { email: { attachmentOf: "m1" } } });
    // Sent: by the AI and by a person (also from the mailbox), whatever its delivery state.
    await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "sent" });
    await createMessage(conversation, { direction: "outbound", senderType: "human", status: "delivered" });
    await createMessage(conversation, { direction: "outbound", senderType: "human", status: "read", contentType: "document" });
    // Not sent: a draft waiting for a person, one still queued and one that failed.
    await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "draft" });
    await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "queued" });
    await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "failed" });

    expect(await getEmailChannelCounters(actorFor("owner"), channel.id)).toEqual({ received: 2, sent: 3, draftsPending: 1 });
  });

  it("solo cuenta lo de ese buzón, y en un buzón real no cuenta lo del simulador", async () => {
    const { channel, conversation } = await mailbox();
    const other = await mailbox();
    await createMessage(conversation, { contentType: "text" });
    await createMessage(conversation, { contentType: "text", simulated: true });
    await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "draft", simulated: true });
    await createMessage(other.conversation, { contentType: "text" });
    await createMessage(other.conversation, { direction: "outbound", senderType: "ai", status: "draft" });

    expect(await getEmailChannelCounters(actorFor("admin"), channel.id)).toEqual({ received: 1, sent: 0, draftsPending: 0 });
  });

  it("[ARR-11] en un buzón de demo todo llega con el simulador, así que sí lo cuenta", async () => {
    const { channel, conversation } = await mailbox({ isDemo: true });
    await createMessage(conversation, { contentType: "text", simulated: true });
    await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "draft", simulated: true });

    expect(await getEmailChannelCounters(actorFor("owner"), channel.id)).toEqual({ received: 1, sent: 0, draftsPending: 1 });
  });

  it("un buzón sin mensajes da ceros", async () => {
    const { channel } = await mailbox({ type: "email_imap" });
    expect(await getEmailChannelCounters(actorFor("owner"), channel.id)).toEqual({ received: 0, sent: 0, draftsPending: 0 });
  });
});

describe("[PER-03] [PER-04] [SEG-04] quién ve los contadores", () => {
  it.each<Role>(["owner", "admin", "viewer"])("%s los ve", async (role) => {
    const { channel } = await mailbox();
    await expect(getEmailChannelCounters(actorFor(role), channel.id)).resolves.toMatchObject({ received: 0 });
  });

  it.each<Role>(["supervisor", "agent"])("%s no: no entra en Canales", async (role) => {
    const { channel } = await mailbox();
    await expect(getEmailChannelCounters(actorFor(role), channel.id)).rejects.toBeInstanceOf(AuthError);
  });

  it("un canal que no es de correo, o un id inventado, es «no encontrado»", async () => {
    await createBusiness();
    const webchat = await createChannel({ type: "webchat" });
    await expect(getEmailChannelCounters(actorFor("owner"), webchat.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getEmailChannelCounters(actorFor("owner"), "no-es-un-id")).rejects.toBeInstanceOf(NotFoundError);
  });
});
