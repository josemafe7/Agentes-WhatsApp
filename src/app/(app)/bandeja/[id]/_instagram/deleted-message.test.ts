// A message the customer deleted in Instagram ([IG-07]): the inbox gets it marked, so it shows «El cliente borró este
// mensaje» instead of its content.
import { beforeEach, describe, expect, it } from "vitest";
import { listMessages } from "@/data/messages";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, messages } from "@/db/schema";
import { actorFor, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { DELETED_BY_CONTACT_TEXT } from "../../_lib/presentation";

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
});

describe("a message deleted by the customer [IG-07]", () => {
  it("comes to the inbox marked as deleted; the others do not", async () => {
    const channel = await createChannel({ type: "instagram", name: "Instagram" });
    const { contact } = await createContactWithIdentity("instagram", { externalId: "1100000000000003", name: "Nuria" });
    const conversation = await createConversation(channel.id, contact.id);
    await createMessage(conversation, { direction: "inbound", senderType: "contact", text: null, metadata: { deletedByContact: "2026-10-16T09:00:00.000Z" } });
    await createMessage(conversation, { direction: "inbound", senderType: "contact", text: "¿Tenéis cita el viernes?" });
    const { items } = await listMessages(actorFor("owner"), { conversationId: conversation.id });
    expect(items.map((item) => [item.text, item.deletedByContact])).toEqual(
      expect.arrayContaining([
        [null, true],
        ["¿Tenéis cita el viernes?", false],
      ]),
    );
    expect(DELETED_BY_CONTACT_TEXT).toBe("El cliente borró este mensaje");
  });
});
