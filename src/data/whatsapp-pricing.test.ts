import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, pricingRates, whatsappTemplates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { encryptWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { AuthError, ValidationError } from "@/server/errors";
import { actorFor, createBusiness, createChannel } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import { connectedNumberRoutes, FAKE_META_BASE_URL, fakeMetaFetch, metaJson, templatesResponse } from "@/test/fixtures/whatsapp/fake-meta";
import { deletePricingRate, findPricingRate, listPricingRates, savePricingRate } from "./whatsapp-pricing";
import { buildWhatsAppTemplateMessage, listWhatsAppTemplates, syncWhatsAppTemplatesNow } from "./whatsapp-templates";

const owner = actorFor("owner");
const admin = actorFor("admin");
let channelId: string;

beforeEach(async () => {
  await db.delete(pricingRates);
  await db.delete(whatsappTemplates);
  await db.delete(channels);
  await createBusiness();
  const channel = await createChannel({
    type: "whatsapp",
    name: "WhatsApp",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
  });
  channelId = channel.id;
});

describe("WhatsApp rates in Ajustes [AJU-09] [WA-47]", () => {
  it("owner and admin save a rate per market and category (never in the code); saving again replaces it", async () => {
    const { id } = await savePricingRate(owner, { country: "es", category: "service", price: 0.0187 });
    await savePricingRate(admin, { country: "ES", category: "service", price: 0.02 });
    const rates = await listPricingRates(owner);
    expect(rates).toEqual([expect.objectContaining({ id, country: "ES", category: "service", price: 0.02, currency: "USD", isExample: false })]);
    expect(await findPricingRate("es", "Service")).toBe(0.02);
    expect(await findPricingRate("FR", "service")).toBeNull();
    await deletePricingRate(owner, id);
    expect(await listPricingRates(owner)).toEqual([]);
  });

  it("a demo rate («ejemplo») stops being an example once a person saves it", async () => {
    await db.insert(pricingRates).values({ country: "ES", category: "utility", price: 0.01, isExample: true });
    await savePricingRate(owner, { country: "ES", category: "utility", price: 0.011 });
    const [rate] = await listPricingRates(owner);
    expect(rate).toMatchObject({ isExample: false, price: 0.011 });
  });

  it.each([
    [{ country: "ESP", category: "service", price: 0.01 }, "country"],
    [{ country: "ES", category: "gratis", price: 0.01 }, "category"],
    [{ country: "ES", category: "service", price: -1 }, "price"],
    [{ country: "ES", category: "service", price: 0.01, freeMessages: 1000 }, "_form"],
  ])("refuses %o with the error next to the field [AJU-15]", async (input, field) => {
    const error = await savePricingRate(owner, input).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toContain(field);
  });

  it.each(["supervisor", "agent", "viewer"] as Role[])("%s cannot see or change the rates", async (role) => {
    const actor = actorFor(role);
    await expect(listPricingRates(actor)).rejects.toBeInstanceOf(AuthError);
    await expect(savePricingRate(actor, { country: "ES", category: "service", price: 1 })).rejects.toBeInstanceOf(AuthError);
    expect(await db.select().from(pricingRates)).toHaveLength(0);
  });
});

describe("WhatsApp templates [WA-22] [WA-43]", () => {
  function meta(templates = templatesResponse()) {
    const fake = fakeMetaFetch(connectedNumberRoutes({ [`GET /${WA_TEST.wabaId}/message_templates`]: () => metaJson(templates) }));
    return { calls: fake.calls, deps: { fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL } };
  }

  it("«Sincronizar» brings status, category, language and variables; what Meta no longer has goes away", async () => {
    await db.insert(whatsappTemplates).values({ channelId, name: "vieja", language: "es", status: "APPROVED" });
    expect(await syncWhatsAppTemplatesNow(owner, channelId, meta().deps)).toEqual({ total: 1, approved: 1 });
    const [template] = await listWhatsAppTemplates(owner, channelId);
    expect(template).toMatchObject({ name: "recordatorio_cita", language: "es", status: "APPROVED", category: "UTILITY", variables: ["nombre", "fecha", "hora"] });
    expect(await listWhatsAppTemplates(owner, channelId)).toHaveLength(1);
  });

  it("builds the message of an approved template with its values for the inbox; a paused one is refused", async () => {
    await syncWhatsAppTemplatesNow(owner, channelId, meta().deps);
    const [template] = await listWhatsAppTemplates(owner, channelId);
    const built = await buildWhatsAppTemplateMessage(owner, channelId, { templateId: template.id, values: { nombre: "Ana", fecha: "3 de octubre", hora: "10:30" } });
    expect(built.text).toBe("Hola Ana, te recordamos tu cita el 3 de octubre a las 10:30.");
    expect(built.metadata.whatsappTemplate).toMatchObject({ name: "recordatorio_cita", language: { code: "es" }, components: [{ type: "body" }] });
    await expect(buildWhatsAppTemplateMessage(owner, channelId, { templateId: template.id, values: { nombre: "Ana" } })).rejects.toBeInstanceOf(ValidationError);
    await db.update(whatsappTemplates).set({ status: "PAUSED" }).where(eq(whatsappTemplates.id, template.id));
    await expect(buildWhatsAppTemplateMessage(owner, channelId, { templateId: template.id, values: { nombre: "Ana", fecha: "x", hora: "y" } })).rejects.toThrow("no está aprobada");
  });

  it("the list is for who sees channels or replies in this one; syncing is for owner and admin", async () => {
    await syncWhatsAppTemplatesNow(owner, channelId, meta().deps);
    await expect(listWhatsAppTemplates(actorFor("viewer"), channelId)).resolves.toHaveLength(1);
    await expect(listWhatsAppTemplates(actorFor("supervisor"), channelId)).resolves.toHaveLength(1);
    await expect(listWhatsAppTemplates(actorFor("agent", { channelIds: [channelId] }), channelId)).resolves.toHaveLength(1);
    await expect(listWhatsAppTemplates(actorFor("agent", { channelIds: [crypto.randomUUID()] }), channelId)).rejects.toBeInstanceOf(AuthError);
    for (const role of ["supervisor", "agent", "viewer"] as Role[]) await expect(syncWhatsAppTemplatesNow(actorFor(role), channelId, meta().deps)).rejects.toBeInstanceOf(AuthError);
    const [template] = await listWhatsAppTemplates(owner, channelId);
    await expect(buildWhatsAppTemplateMessage(actorFor("viewer"), channelId, { templateId: template.id, values: {} })).rejects.toBeInstanceOf(AuthError);
  });
});
