// WhatsApp of the demo (seed/steps/whatsapp.ts) ([ARR-06], [ARR-11], [WA-22], [WA-43], [WA-47], [AJU-09]): the demo
// number's synced templates and the example rates, and the whole template flow of a closed window through the
// DemoAdapter, priced as Meta would price it. (Kept here because Vitest only collects tests under src/ and scripts/.)
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listWhatsAppTemplates } from "@/data/whatsapp-templates";
import { listPricingRates } from "@/data/whatsapp-pricing";
import { getWhatsAppInboxState, sendHumanTemplateMessage } from "@/data/whatsapp-send";
import { db } from "@/db";
import { channels, contacts, conversations, jobs, messages, user, userRoles } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { getJobQueue } from "@/server/adapters/job-queue";
import { DEMO_STATUS_JOB } from "@/server/channels/demo-adapter";
import "@/server/jobs/handlers";
import { getJobRegistration } from "@/server/jobs/registry";
import { DEMO_BUSINESSES } from "../../seed/businesses";
import { buildDemoTemplates, DEMO_EXAMPLE_RATES } from "../../seed/steps/whatsapp";
import { getSectorPreset } from "@/lib/sectors";
import { DEMO_USERS } from "../../seed/users";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase } from "./testing";

const DEMO_ENV = { DEMO_MODE: "true", NODE_ENV: "development" };

async function demoActor(role: Role): Promise<Actor> {
  const demoUser = DEMO_USERS.find((candidate) => candidate.role === role);
  const [row] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(eq(user.email, demoUser?.email ?? ""));
  return { userId: row.id, role, name: row.name, channelIds: null };
}

async function demoWhatsApp() {
  const [row] = await db.select().from(channels).where(eq(channels.type, "whatsapp"));
  return row;
}

describe("WhatsApp of the demo (pnpm seed)", () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error("La demo nunca llama a Meta.")));

  beforeAll(async () => {
    vi.stubGlobal("fetch", fetchSpy);
    await emptyDatabase();
    expect(await runSeedCommand([], { out: captureOutput(), env: DEMO_ENV })).toBe(0);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("[WA-22] [ARR-11] the demo number has its templates as «Sincronizar plantillas» leaves them: two approved, one pending and one rejected", async () => {
    const templates = await listWhatsAppTemplates(await demoActor("owner"), (await demoWhatsApp()).id);
    expect(templates.map((template) => [template.name, template.status, template.category])).toEqual([
      ["aviso_cierre", "REJECTED", "UTILITY"],
      ["novedades_del_mes", "PENDING", "MARKETING"],
      ["recordatorio_cita", "APPROVED", "UTILITY"],
      ["retomar_conversacion", "APPROVED", "UTILITY"],
    ]);
    expect(templates.find((template) => template.name === "recordatorio_cita")?.variables).toEqual(["nombre", "fecha", "hora"]);
    expect(templates.find((template) => template.name === "retomar_conversacion")?.variables).toEqual(["1"]);
    expect(templates.find((template) => template.name === "aviso_cierre")?.rejectedReason).toBe("INVALID_FORMAT");
    // In the business's own words: the sector's booking term and its name.
    const body = JSON.stringify(buildDemoTemplates(DEMO_BUSINESSES.peluqueria, getSectorPreset("peluqueria"))[0].components);
    expect(body).toContain("tu cita en Peluquería Aurora");
  });

  it("[AJU-09] Ajustes › WhatsApp shows example rates, flagged «ejemplo», never as real prices", async () => {
    const rates = await listPricingRates(await demoActor("owner"));
    expect(rates).toHaveLength(DEMO_EXAMPLE_RATES.length);
    for (const rate of rates) expect(rate).toMatchObject({ country: "ES", currency: "USD", isExample: true });
  });

  it("[WA-43] [BAN-08] [WA-47] a closed window offers the approved templates; one sent goes through the DemoAdapter and gets its estimated cost", async () => {
    const owner = await demoActor("owner");
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(contacts.name, "Cristina Herrero"));
    const state = await getWhatsAppInboxState(owner, row.id);
    expect(state?.window.open).toBe(false);
    expect(state?.templates.map((template) => template.name)).toEqual(["recordatorio_cita", "retomar_conversacion"]);

    const template = state?.templates.find((candidate) => candidate.name === "recordatorio_cita");
    await db.delete(jobs);
    const sent = await sendHumanTemplateMessage(owner, {
      conversationId: row.id,
      templateId: template?.id,
      values: { nombre: "Cristina", fecha: "3 de octubre", hora: "10:30" },
    });
    expect(sent.status).toBe("sent");
    expect(fetchSpy).not.toHaveBeenCalled();

    // «Entregado» and «leído» as the demo simulates them, with the pricing Meta would give a utility template.
    const registration = getJobRegistration(DEMO_STATUS_JOB);
    for (const job of (await db.select().from(jobs).where(eq(jobs.type, DEMO_STATUS_JOB))).sort((a, b) => a.runAt.getTime() - b.runAt.getTime())) {
      await registration?.handler(job.payload, { job, workerId: "w", queue: getJobQueue(), remainingMs: () => 10_000, rescheduleAt: () => {} });
    }
    const [message] = await db.select().from(messages).where(and(eq(messages.id, sent.messageId), eq(messages.contentType, "template")));
    expect(message.text).toContain("Hola, Cristina. Te recordamos tu cita en Peluquería Aurora el 3 de octubre a las 10:30.");
    const utility = DEMO_EXAMPLE_RATES.find((rate) => rate.category === "utility");
    expect(message).toMatchObject({ status: "read", pricingType: "regular", pricingCategory: "utility", costEstimate: utility?.price });
  });
});
