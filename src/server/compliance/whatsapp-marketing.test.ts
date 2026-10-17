// The bajas of novedades y publicidad that come from WhatsApp ([WA-62], [YC-11]): the template's baja button (one
// confirmation, no AI reply), the customer stopping marketing in WhatsApp (Meta's `user_preferences`, YCloud's event)
// and Meta's 131050. A resume is only noted; nobody unknown is created; the reminders of their bookings go on.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, channels, consents, contactIdentities, contacts, conversations, jobs, messages, whatsappTemplates } from "@/db/schema";
import { blockReason } from "@/lib/consents";
import { normalizeWhatsAppWebhook } from "@/server/channels/whatsapp/normalize";
import { recordMetaFailure } from "@/server/channels/whatsapp/failures";
import { normalizeYCloudEvent } from "@/server/channels/ycloud/normalize";
import type { ChannelRecord, InboundMessageEvent } from "@/server/channels/types";
import { ingestEvents } from "@/server/inbound/ingest";
import { REPLY_JOB } from "@/server/engine/schedule";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { loadConsentState } from "./consent-state";
import { OPT_OUT_CONFIRMATION_JOB } from "./opt-out";
import { applyMarketingPreference } from "./whatsapp-marketing";

const BSUID = "ES.10000000000000000042";
const WA_ID = "34600111222";
let channel: ChannelRecord;
let contactId: string;

beforeEach(async () => {
  for (const table of [jobs, auditLog, messages, conversations, consents, contactIdentities, contacts, whatsappTemplates]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  channel = await createChannel({ type: "whatsapp", name: "WhatsApp", status: "connected", phoneNumberId: "200000000000002", wabaId: "100000000000001", isDemo: true });
  contactId = (await createContactWithIdentity("whatsapp", { name: "Ana", externalId: BSUID, phone: WA_ID })).contact.id;
  await db.insert(consents).values([
    { contactId, type: "reminders_granted", source: "person" },
    { contactId, type: "marketing_granted", source: "person" },
  ]);
});

const marketingBlock = async () => blockReason(await loadConsentState(contactId), "whatsapp", "marketing");

describe("«No quiero publicidad», the baja button of a template [WA-62]", () => {
  async function tapOnTemplate(roles: Record<string, "marketing_opt_out" | "confirm">, text = "No quiero publicidad") {
    const [template] = await db
      .insert(whatsappTemplates)
      .values({ channelId: channel.id, name: "novedades", language: "es", category: "MARKETING", status: "APPROVED", buttonRoles: roles })
      .returning();
    const conversation = await createConversation(channel.id, contactId);
    await createMessage(conversation, { direction: "outbound", senderType: "system", contentType: "template", externalId: "wamid.NOVEDADES_1", metadata: { templateId: template.id } });
    const tap: InboundMessageEvent = {
      kind: "inbound_message",
      externalId: "wamid.TAP_1",
      sender: { externalIds: [BSUID], displayName: "Ana", phone: WA_ID },
      contentType: "interactive",
      text,
      sentAt: new Date(),
      metadata: { button: { text, payload: text }, quotedExternalId: "wamid.NOVEDADES_1" },
    };
    await ingestEvents(channel, [tap]);
    return conversation;
  }

  it("opts them out of publicidad by WhatsApp with its origin, sends one confirmation and the AI does not answer the tap", async () => {
    await tapOnTemplate({ "No quiero publicidad": "marketing_opt_out" });
    expect(await marketingBlock()).toBe("marketing_opted_out");
    expect(blockReason(await loadConsentState(contactId), "whatsapp", "reminder")).toBeNull();
    const [row] = await db.select().from(consents).where(eq(consents.type, "marketing_opt_out"));
    expect(row).toMatchObject({ channelKind: "whatsapp", source: "template_button", actorType: "contact" });
    expect((await db.select().from(jobs)).map((job) => job.type)).toEqual([OPT_OUT_CONFIRMATION_JOB]);
  });

  it("another button of the template is a message like any other", async () => {
    await tapOnTemplate({ Más: "confirm" }, "Más");
    expect(await marketingBlock()).toBeNull();
    expect((await db.select().from(jobs)).map((job) => job.type)).toEqual([REPLY_JOB]);
  });
});

describe("the customer stops or resumes marketing in WhatsApp [WA-62] [YC-11]", () => {
  it("Meta's notice names the number and the customer; a stop is a baja of publicidad, a resume only a note", async () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "100000000000001",
          changes: [
            {
              field: "user_preferences",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "15550001111", phone_number_id: "200000000000002" },
                user_preferences: [{ wa_id: WA_ID, user_id: BSUID, detail: "User requested to stop marketing messages", category: "marketing_messages", value: "stop", timestamp: 1790500000 }],
              },
            },
          ],
        },
      ],
    };
    const [change] = normalizeWhatsAppWebhook(body) ?? [];
    expect(change).toMatchObject({ kind: "account", field: "user_preferences", phoneNumberId: "200000000000002" });

    expect(await applyMarketingPreference(channel.id, { userId: BSUID, waId: WA_ID, value: "stop" }, new Date())).toBe(true);
    expect(await marketingBlock()).toBe("marketing_opted_out");
    // Meta may send it again: nothing changes.
    expect(await applyMarketingPreference(channel.id, { userId: BSUID, waId: WA_ID, value: "stop" }, new Date())).toBe(false);
    expect(await applyMarketingPreference(channel.id, { userId: BSUID, waId: WA_ID, value: "resume" }, new Date())).toBe(true);
    expect(await marketingBlock()).toBe("marketing_opted_out");
    expect((await db.select().from(consents).where(eq(consents.type, "marketing_resumed"))).map((row) => row.source)).toEqual(["whatsapp_app"]);
  });

  it("YCloud's event says the same; a customer the app does not know is not created", async () => {
    const event = normalizeYCloudEvent({
      id: "evt_1",
      type: "whatsapp.user.preferences",
      apiVersion: "v2",
      whatsappUserPreference: { wabaId: "100000000000001", businessPhoneNumber: "+15550001111", contactPhoneNumber: `+${WA_ID}`, userId: BSUID, category: "marketing_messages", value: "stop", timestamp: "1779796800000" },
    });
    expect(event?.change).toEqual({ kind: "preference", number: "15550001111", preference: { userId: BSUID, waId: WA_ID, value: "stop" } });
    expect(await applyMarketingPreference(channel.id, { userId: "US.99999999999999999999", waId: "15559999999", value: "stop" }, new Date())).toBe(false);
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it("Meta refusing a marketing template with 131050 is a baja of publicidad too", async () => {
    const conversation = await createConversation(channel.id, contactId);
    await recordMetaFailure(channel, { conversationId: conversation.id, code: 131050, serviceMessage: false, now: new Date() });
    expect(await marketingBlock()).toBe("marketing_opted_out");
    const [row] = await db.select().from(consents).where(eq(consents.type, "marketing_opt_out"));
    expect(row.source).toBe("meta_131050");
  });
});
