// When an envío stops in the middle of a round ([ENV-09], [ENV-10], [TG-12], [MOT-15]): Meta restricts the account or
// pauses the template, or a channel goes down, even at the very moment of sending (it stops at the first one, that
// contact waits untried and never goes by the next channel); more than 5 failures of the channel stop it right away,
// not at the next round; a person pausing it stops the round under way; cancelled meanwhile, nobody is left waiting in
// it; a WhatsApp failure reported later on a finished envío goes by the next channel even with a round at the same
// time; a customer who blocked the bot is «No enviado», not a failure of the channel; and a round never starts a contact
// without time left. The channels' answers are stood in for here: the demo channels never fail.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelCampaign, scheduleCampaign } from "@/data/campaigns";
import { db, getDb } from "@/db";
import { auditLog, campaignRecipients, campaigns, channels, consents, contactIdentities, contacts, conversations, jobs, messages, notifications, whatsappTemplates } from "@/db/schema";
import { createChannel, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { runCampaigns } from "./runner";

type Hook = (send: (...args: never[]) => Promise<unknown>, args: never[]) => Promise<unknown>;
const hooks = vi.hoisted(() => ({ whatsapp: null as Hook | null, telegram: null as Hook | null }));

vi.mock("@/data/whatsapp-send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/data/whatsapp-send")>();
  const sendTemplateMessage = (...args: never[]) => (hooks.whatsapp ? hooks.whatsapp(original.sendTemplateMessage as never, args) : (original.sendTemplateMessage as (...a: never[]) => Promise<unknown>)(...args));
  return { ...original, sendTemplateMessage };
});
vi.mock("@/server/outbound/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/outbound/send")>();
  const sendOutbound = (...args: never[]) => (hooks.telegram ? hooks.telegram(original.sendOutbound as never, args) : (original.sendOutbound as (...a: never[]) => Promise<unknown>)(...args));
  return { ...original, sendOutbound };
});

// Tuesday 20 October 2026, 10:00 in Madrid.
const NOW = new Date("2026-10-20T08:00:00Z");
const DAY_MS = 24 * 60 * 60_000;

let owner: TestUser;
let whatsapp: typeof channels.$inferSelect;
let telegram: typeof channels.$inferSelect;

async function customers(count: number) {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const [contact] = await db.insert(contacts).values({ name: `Cliente ${index + 1}`, phone: `3461${String(index).padStart(7, "0")}` }).returning();
    await db.insert(contactIdentities).values({ contactId: contact.id, channelType: "whatsapp", externalId: `ES.${crypto.randomUUID()}`, phone: contact.phone });
    await db.insert(consents).values({ contactId: contact.id, type: "marketing_granted", source: "person", method: "in_person", actorType: "user", createdAt: new Date(NOW.getTime() - 30 * DAY_MS) });
    ids.push(contact.id);
  }
  return ids;
}

const schedule = (ids: string[], overrides: Record<string, unknown> = {}) =>
  scheduleCampaign(
    owner.actor,
    {
      name: "Bonos",
      routes: ["whatsapp"],
      whatsapp: { channelId: whatsapp.id, templateName: "novedades_y_publicidad", templateLanguage: "es", variables: { "1": { field: "business.name" } } },
      sendAt: "now",
      audience: { ids },
      ...overrides,
    },
    { now: NOW },
  );

/** Customers who may get it by WhatsApp and also by the bot (they wrote to it). */
async function withBoth(count: number) {
  const ids = await customers(count);
  for (const [index, contactId] of ids.entries()) {
    const chatId = String(820_000_000 + index);
    await db.insert(contactIdentities).values({ contactId, channelType: "telegram", externalId: chatId });
    const conversation = await createConversation(telegram.id, contactId);
    await createMessage(conversation, { text: "Hola", metadata: { telegramChatId: chatId }, createdAt: new Date(NOW.getTime() - DAY_MS) });
  }
  return ids;
}
const byBoth = () => ({ routes: ["whatsapp", "telegram"], telegram: { channelId: telegram.id, text: "Novedades" } });
const byTelegram = () => db.select().from(messages).where(and(eq(messages.channelId, telegram.id), eq(messages.direction, "outbound")));

const rowsOf = (campaignId: string) => db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaignId));
const campaignOf = async (id: string) => (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0];
const failWith = (code: number, message = "Fallo de prueba"): Hook => async () => ({ messageId: crypto.randomUUID(), status: "failed", error: { code, message } });

beforeEach(async () => {
  hooks.whatsapp = null;
  hooks.telegram = null;
  for (const table of [campaignRecipients, campaigns, messages, conversations, consents, contactIdentities, whatsappTemplates, notifications, auditLog, jobs]) await db.delete(table);
  await db.delete(contacts);
  await db.delete(channels);
  owner = await createUser("owner", { name: "Elena Dueña" });
  whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true, status: "connected", messagingLimit: "TIER_1K" });
  telegram = await createChannel({ type: "telegram", name: "Bot", isDemo: true, status: "connected" });
  await db.insert(whatsappTemplates).values({
    channelId: whatsapp.id,
    name: "novedades_y_publicidad",
    language: "es",
    category: "MARKETING",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Hola, te escribimos desde {{1}}." }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "No quiero publicidad" }] }],
    variables: ["1"],
    variableBindings: { "1": "business.name" },
    buttonRoles: { "No quiero publicidad": "marketing_opt_out" },
  });
});

afterEach(() => {
  hooks.whatsapp = null;
  hooks.telegram = null;
});

describe("Meta stops the account or the template [ENV-09]", () => {
  it.each([
    [131048, /calidad o por sospecha de spam/],
    [368, /restringido el número o la cuenta/],
    [132015, /plantilla/],
  ])("Meta answers %i: it stops at the first one, says why, and that contact waits untried", async (code, reason) => {
    const { id } = await schedule(await customers(5));
    hooks.whatsapp = failWith(code);
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 0, failed: 0 });
    const campaign = await campaignOf(id);
    expect(campaign).toMatchObject({ status: "paused", pausedBy: "system" });
    expect(campaign.pausedReason).toMatch(reason);
    const rows = await rowsOf(id);
    expect(rows.map((row) => row.status)).toEqual(["pending", "pending", "pending", "pending", "pending"]);
    expect(rows.every((row) => row.attempts.length === 0)).toBe(true);
    // [ENV-13] The log says why, without personal data.
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "campaign.paused"));
    expect(entry.metadata).toMatchObject({ by: "system", reason: campaign.pausedReason });
  });

  it("more than 5 failures of the channel in the same round stop it there, not at the next round", async () => {
    const { id } = await schedule(await customers(20));
    hooks.whatsapp = failWith(131000, "No se pudo enviar por un error de Meta.");
    expect(await runCampaigns({ now: NOW })).toMatchObject({ failed: 6 });
    const campaign = await campaignOf(id);
    expect(campaign.status).toBe("paused");
    expect(campaign.pausedReason).toMatch(/demasiados mensajes por WhatsApp/);
    expect((await rowsOf(id)).filter((row) => row.status === "pending")).toHaveLength(14);
  });

  it("resumed by hand after too many failures, it goes on: the failures before do not stop it again", async () => {
    const { id } = await schedule(await customers(20));
    hooks.whatsapp = failWith(131000, "No se pudo enviar por un error de Meta.");
    await runCampaigns({ now: NOW });
    expect((await campaignOf(id)).status).toBe("paused");
    hooks.whatsapp = null;
    const { resumeCampaign } = await import("@/data/campaigns");
    await resumeCampaign(owner.actor, id, { now: new Date(NOW.getTime() + 60_000) });
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 61_000) })).toMatchObject({ sent: 14 });
    expect((await campaignOf(id)).status).toBe("sending");
  });

  it("Meta pauses the template in the middle of a round: it stops before the next contact, who waits untried", async () => {
    const { id } = await schedule(await customers(10));
    let calls = 0;
    hooks.whatsapp = async (send, args) => {
      calls += 1;
      const sent = await send(...args);
      if (calls === 2) await db.update(whatsappTemplates).set({ status: "PAUSED" });
      return sent;
    };
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 2, failed: 0 });
    const campaign = await campaignOf(id);
    expect(campaign).toMatchObject({ status: "paused", pausedBy: "system" });
    expect(campaign.pausedReason).toMatch(/plantilla/);
    const waiting = (await rowsOf(id)).filter((row) => row.status === "pending");
    expect(waiting).toHaveLength(8);
    expect(waiting.every((row) => row.attempts.length === 0)).toBe(true);
  });

  it("…and if Meta refuses it at the very moment of sending, that contact waits untried too", async () => {
    const { id } = await schedule(await customers(3));
    hooks.whatsapp = async () => {
      await db.update(whatsappTemplates).set({ status: "PAUSED" });
      throw new Error("La plantilla ya no está aprobada.");
    };
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 0, failed: 0 });
    expect((await campaignOf(id)).pausedReason).toMatch(/plantilla/);
    expect((await rowsOf(id)).every((row) => row.status === "pending" && row.attempts.length === 0)).toBe(true);
  });

  it("a channel that goes down in the middle of a round stops it before the next contact", async () => {
    const { id } = await schedule(await customers(6));
    let calls = 0;
    hooks.whatsapp = async (send, args) => {
      calls += 1;
      const sent = await send(...args);
      if (calls === 2) await db.update(channels).set({ isDemo: false, status: "error" }).where(eq(channels.id, whatsapp.id));
      return sent;
    };
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 2 });
    expect(await campaignOf(id)).toMatchObject({ status: "paused", pausedBy: "system" });
    expect((await rowsOf(id)).filter((row) => row.status === "pending")).toHaveLength(4);
  });

  it("a recipient's own failures never stop it", async () => {
    const { id } = await schedule(await customers(10));
    hooks.whatsapp = failWith(131026, "No se pudo entregar: el cliente no tiene WhatsApp o debe actualizarlo.");
    expect(await runCampaigns({ now: NOW })).toMatchObject({ failed: 10 });
    expect((await campaignOf(id)).status).toBe("sending");
  });

  it("[ENV-09] a channel that goes down in the middle of a round stops it also with another channel marked: nobody gets it by the next one", async () => {
    const { id } = await schedule(await withBoth(6), byBoth());
    let calls = 0;
    hooks.whatsapp = async (send, args) => {
      calls += 1;
      const sent = await send(...args);
      if (calls === 2) await db.update(channels).set({ isDemo: false, status: "error" }).where(eq(channels.id, whatsapp.id));
      return sent;
    };
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 2, failed: 0 });
    expect(await campaignOf(id)).toMatchObject({ status: "paused", pausedBy: "system" });
    const rows = await rowsOf(id);
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(4);
    expect(rows.filter((row) => row.channel === "telegram")).toEqual([]);
    expect(await byTelegram()).toEqual([]);
  });

  it("[ENV-09] the channel is switched off at the very moment of sending: it stops at that contact, who waits untried, never by the next channel", async () => {
    const { id } = await schedule(await withBoth(5), byBoth());
    let calls = 0;
    hooks.whatsapp = async (send, args) => {
      calls += 1;
      // After the check before this contact: sending to a channel switched off is refused.
      if (calls === 3) await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, whatsapp.id));
      return send(...args);
    };
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 2, failed: 0 });
    const campaign = await campaignOf(id);
    expect(campaign).toMatchObject({ status: "paused", pausedBy: "system" });
    expect(campaign.pausedReason).toMatch(/^WhatsApp: el canal no está conectado/);
    const waiting = (await rowsOf(id)).filter((row) => row.status === "pending");
    expect(waiting).toHaveLength(3);
    expect(waiting.every((row) => row.attempts.length === 0)).toBe(true);
    expect(await byTelegram()).toEqual([]);
  });

  it.each([130403, 130472, 130497])("Meta answers %i, of that recipient: it counts against the contact, not the channel, and never stops it [ENV-09]", async (code) => {
    const { id } = await schedule(await customers(7));
    hooks.whatsapp = failWith(code);
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 0, failed: 7 });
    expect((await campaignOf(id)).status).toBe("sending");
    const rows = await rowsOf(id);
    expect(rows.every((row) => row.status === "failed" && row.attempts.every((attempt) => !attempt.reason?.startsWith("Error del canal")))).toBe(true);
  });

  it("[ENV-09] Meta answers 131063 (publicidad switched off for the Cloud API): it stops at the first one, who waits untried", async () => {
    const { id } = await schedule(await customers(3));
    hooks.whatsapp = failWith(131063, "Marketing desactivado en la Cloud API");
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 0, failed: 0 });
    const campaign = await campaignOf(id);
    expect(campaign).toMatchObject({ status: "paused", pausedBy: "system" });
    expect(campaign.pausedReason).toMatch(/restringido el número o la cuenta/);
    expect((await rowsOf(id)).every((row) => row.status === "pending" && row.attempts.length === 0)).toBe(true);
  });
});

describe("cancelled while a round goes [ENV-10] [CUM-05]", () => {
  it("cancelled at the very moment Meta stops the account: nobody is left waiting in it", async () => {
    const { id } = await schedule(await customers(3));
    hooks.whatsapp = async () => {
      await cancelCampaign(owner.actor, id, { now: NOW });
      return { messageId: crypto.randomUUID(), status: "failed", error: { code: 368, message: "Cuenta restringida" } };
    };
    await runCampaigns({ now: NOW });
    expect((await campaignOf(id)).status).toBe("cancelled");
    const rows = await rowsOf(id);
    expect(rows.map((row) => row.status)).toEqual(["not_sent", "not_sent", "not_sent"]);
    expect(rows.every((row) => row.reason === "El envío se canceló")).toBe(true);
  });

  it("cancelled while one waits for room in its next channel: it does not stay waiting either", async () => {
    const { id } = await schedule(await withBoth(1), byBoth());
    // Telegram already sent its 20 this minute.
    const [other] = await db.insert(campaigns).values({ name: "Otro", status: "finished", scheduledAt: NOW, routes: ["telegram"] }).returning();
    await db.insert(campaignRecipients).values(Array.from({ length: 20 }, () => ({ campaignId: other.id, status: "sent" as const, channel: "telegram", sentAt: NOW })));
    hooks.whatsapp = async () => {
      await cancelCampaign(owner.actor, id, { now: NOW });
      return { messageId: crypto.randomUUID(), status: "failed", error: { code: 131000, message: "No se pudo enviar por un error de Meta." } };
    };
    await runCampaigns({ now: NOW });
    const [row] = await rowsOf(id);
    expect(row).toMatchObject({ status: "not_sent", reason: "El envío se canceló" });
    expect(await byTelegram()).toEqual([]);
  });

  it("a WhatsApp failure reported later, while it is cancelled: the contact is «Fallido», never waiting", async () => {
    const { applyWhatsAppStatuses } = await import("@/server/channels/whatsapp/statuses");
    const { CAMPAIGN_FALLBACK_JOB, campaignFallbackPayload, runCampaignFallback } = await import("./fallback");
    const { id } = await schedule(await withBoth(1), byBoth());
    await runCampaigns({ now: NOW });
    const [row] = await rowsOf(id);
    const [message] = await db.select().from(messages).where(eq(messages.id, row.messageId ?? ""));
    await applyWhatsAppStatuses(whatsapp, [{ kind: "status_update", externalId: message.externalId ?? "", status: "failed", at: NOW, error: { code: 131026, message: "No entregable" } }], NOW);
    const [job] = await db.select().from(jobs).where(eq(jobs.type, CAMPAIGN_FALLBACK_JOB));
    // The fallback reads the envío still sending; it is cancelled before it writes.
    const fallback = runCampaignFallback(campaignFallbackPayload.parse(job.payload), { now: NOW });
    await cancelCampaign(owner.actor, id, { now: NOW });
    await fallback;
    expect((await campaignOf(id)).status).toBe("cancelled");
    expect((await rowsOf(id))[0]).toMatchObject({ status: "failed" });
  });
});

describe("a person pauses it while a round goes [ENV-10]", () => {
  it("nothing more goes out after the pause, not even in that round", async () => {
    const { id } = await schedule(await customers(10));
    let calls = 0;
    hooks.whatsapp = async (send, args) => {
      calls += 1;
      const sent = await send(...args);
      if (calls === 3) await db.update(campaigns).set({ status: "paused", pausedBy: "person", pausedReason: "Lo ha pausado una persona del equipo." }).where(eq(campaigns.id, id));
      return sent;
    };
    expect(await runCampaigns({ now: NOW })).toMatchObject({ sent: 3 });
    expect((await rowsOf(id)).filter((row) => row.status === "pending")).toHaveLength(7);
  });
});

describe("Telegram: the customer blocked the bot [TG-12]", () => {
  it("is «No enviado: Ha bloqueado el bot», not a failure of the channel, and never stops the envío", async () => {
    const people: string[] = [];
    for (let index = 0; index < 8; index++) {
      const [contact] = await db.insert(contacts).values({ name: `Bot ${index}` }).returning();
      await db.insert(contactIdentities).values({ contactId: contact.id, channelType: "telegram", externalId: String(810_000_000 + index) });
      const conversation = await createConversation(telegram.id, contact.id);
      await createMessage(conversation, { text: "Hola", metadata: { telegramChatId: String(810_000_000 + index) }, createdAt: new Date(NOW.getTime() - DAY_MS) });
      await db.insert(consents).values({ contactId: contact.id, type: "marketing_granted", source: "person", method: "in_person", actorType: "user", createdAt: new Date(NOW.getTime() - 30 * DAY_MS) });
      people.push(contact.id);
    }
    const { id } = await schedule(people, { routes: ["telegram"], whatsapp: null, telegram: { channelId: telegram.id, text: "Novedades" } });
    hooks.telegram = failWith(403, "El cliente ha bloqueado el bot.");
    expect(await runCampaigns({ now: NOW })).toMatchObject({ notSent: 8, failed: 0 });
    const rows = await rowsOf(id);
    expect(rows.every((row) => row.status === "not_sent" && row.reason === "Ha bloqueado el bot")).toBe(true);
    expect((await campaignOf(id)).status).not.toBe("paused");
  });
});

describe("the time of the round [MOT-15]", () => {
  it("no contact is started without time left: they wait for the next round", async () => {
    const { id } = await schedule(await customers(3));
    expect(await runCampaigns({ now: NOW, timeLeft: () => 5_000 })).toMatchObject({ sent: 0 });
    expect((await rowsOf(id)).map((row) => row.status)).toEqual(["pending", "pending", "pending"]);
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 61_000) })).toMatchObject({ sent: 3 });
  });
});

describe("the WhatsApp failure reported later [ENV-03] [ENV-09]", () => {
  it("with a code that stops it, the envío stops and the contact waits untried for it to be resumed", async () => {
    const { applyWhatsAppStatuses } = await import("@/server/channels/whatsapp/statuses");
    const { CAMPAIGN_FALLBACK_JOB, campaignFallbackPayload, runCampaignFallback } = await import("./fallback");
    const { id } = await schedule(await customers(2));
    await runCampaigns({ now: NOW });
    const [row] = await db.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "sent")));
    const [message] = await db.select().from(messages).where(eq(messages.id, row.messageId ?? ""));
    await applyWhatsAppStatuses(whatsapp, [{ kind: "status_update", externalId: message.externalId ?? "", status: "failed", at: NOW, error: { code: 131048, message: "Restricción por spam o calidad" } }], NOW);
    const [job] = await db.select().from(jobs).where(eq(jobs.type, CAMPAIGN_FALLBACK_JOB));
    await runCampaignFallback(campaignFallbackPayload.parse(job.payload), { now: NOW });
    expect(await campaignOf(id)).toMatchObject({ status: "paused", pausedBy: "system" });
    const [after] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, row.id));
    expect(after).toMatchObject({ status: "pending", messageId: null, sentAt: null });
    expect(after.attempts).toEqual([]);
  });

  it("with a code of the recipient (130497: the account may not write to their country), it counts against the contact, not the channel", async () => {
    const { applyWhatsAppStatuses } = await import("@/server/channels/whatsapp/statuses");
    const { CAMPAIGN_FALLBACK_JOB, campaignFallbackPayload, runCampaignFallback } = await import("./fallback");
    const { id } = await schedule(await customers(1));
    await runCampaigns({ now: NOW });
    const [row] = await rowsOf(id);
    const [message] = await db.select().from(messages).where(eq(messages.id, row.messageId ?? ""));
    await applyWhatsAppStatuses(whatsapp, [{ kind: "status_update", externalId: message.externalId ?? "", status: "failed", at: NOW, error: { code: 130497, message: "Cuenta restringida para ese país" } }], NOW);
    const [job] = await db.select().from(jobs).where(eq(jobs.type, CAMPAIGN_FALLBACK_JOB));
    const payload = campaignFallbackPayload.parse(job.payload);
    expect(payload.channelFault).toBe(false);
    await runCampaignFallback(payload, { now: NOW });
    const [after] = await rowsOf(id);
    expect(after.status).toBe("failed");
    expect(after.attempts).toEqual([expect.objectContaining({ channel: "whatsapp", outcome: "failed" })]);
    expect(after.attempts[0].reason).not.toMatch(/^Error del canal/);
    expect((await campaignOf(id)).status).not.toBe("paused");
  });

  it("[ENV-03] [CUM-05] on a finished envío, a round at the same time never finds the contact waiting in it still finished: it goes by the next channel", async () => {
    const { applyWhatsAppStatuses } = await import("@/server/channels/whatsapp/statuses");
    const { CAMPAIGN_FALLBACK_JOB, campaignFallbackPayload, runCampaignFallback } = await import("./fallback");
    const { id } = await schedule(await withBoth(1), byBoth());
    await runCampaigns({ now: NOW });
    await runCampaigns({ now: new Date(NOW.getTime() + 61_000) });
    expect((await campaignOf(id)).status).toBe("finished");
    const [row] = await rowsOf(id);
    const [message] = await db.select().from(messages).where(eq(messages.id, row.messageId ?? ""));
    await applyWhatsAppStatuses(whatsapp, [{ kind: "status_update", externalId: message.externalId ?? "", status: "failed", at: NOW, error: { code: 131026, message: "No entregable" } }], NOW);
    const [job] = await db.select().from(jobs).where(eq(jobs.type, CAMPAIGN_FALLBACK_JOB));
    // Rounds run in parallel with the fallback: one runs right after the contact is written back to wait, when that
    // write goes on its own, before the fallback's next step.
    const later = new Date(NOW.getTime() + 2 * 60_000);
    const real = getDb();
    const update = real.update.bind(real);
    let raced = false;
    const spy = vi.spyOn(real, "update").mockImplementation(((table: typeof campaignRecipients) => {
      const builder = update(table);
      if (table !== campaignRecipients || raced) return builder;
      const set = builder.set.bind(builder);
      builder.set = ((values) => {
        const query = set(values);
        if (values.status !== "pending") return query;
        raced = true;
        const then = query.then.bind(query);
        query.then = ((done, fail) =>
          then(async (rows) => {
            await runCampaigns({ now: later });
            return rows;
          }).then(done, fail)) as typeof query.then;
        return query;
      }) as typeof builder.set;
      return builder;
    }) as never);
    try {
      await runCampaignFallback(campaignFallbackPayload.parse(job.payload), { now: later });
    } finally {
      spy.mockRestore();
    }
    expect(await runCampaigns({ now: new Date(NOW.getTime() + 3 * 60_000) })).toMatchObject({ sent: 1 });
    expect((await rowsOf(id))[0]).toMatchObject({ status: "sent", channel: "telegram" });
    expect(await byTelegram()).toHaveLength(1);
  });
});
