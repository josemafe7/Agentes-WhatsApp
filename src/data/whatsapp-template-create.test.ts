// «Nueva plantilla» ([WA-57]–[WA-60], [YC-07], [ARR-25]): created from the app with Meta (named parameters) or YCloud
// (numbered ones), «En revisión» until the answer; approved at once on a demo channel; what each data and button is
// remembered and kept by the syncs; a rejection or a change of category is noted and told to the owner and the
// admins. Meta and YCloud are the documented fakes: nothing leaves the test.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, channelMembers, channels, notifications, whatsappTemplates } from "@/db/schema";
import { templateModels } from "@/lib/whatsapp-template-draft";
import { encryptWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { storeWhatsAppTemplates } from "@/server/channels/whatsapp/templates";
import { encryptYCloudSecrets } from "@/server/channels/ycloud/config";
import { createBusiness, createChannel, createUser } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import { FAKE_META_BASE_URL, fakeMetaFetch, metaError, metaJson, metaRoutes, type MetaCall } from "@/test/fixtures/whatsapp/fake-meta";
import { fakeYCloudFetch, ycloudRoutes, ycOk, YC_TEST, type YCloudCall } from "@/test/fixtures/ycloud";
import { createWhatsAppTemplate, listWhatsAppTemplates, setTemplateButtonRoles } from "./whatsapp-templates";

const reminder = templateModels({ healthData: true })[0].draft;
let metaCalls: MetaCall[];

function meta(answer: () => Response) {
  const fake = fakeMetaFetch(metaRoutes({ [`POST /${WA_TEST.wabaId}/message_templates`]: answer }));
  metaCalls = fake.calls;
  vi.stubGlobal("fetch", fake.fetch);
}

async function metaChannel() {
  return createChannel({
    type: "whatsapp",
    name: "WhatsApp principal",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: "246810" }),
  });
}

beforeEach(async () => {
  for (const table of [notifications, auditLog, whatsappTemplates, channelMembers]) await db.delete(table);
  await db.delete(channels);
  await createBusiness({ name: "Fisioterapia Movimiento" });
  vi.stubEnv("META_GRAPH_BASE_URL", FAKE_META_BASE_URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Nueva plantilla with Meta [WA-57] [WA-58]", () => {
  it("sends «Recordatorio de cita» with its examples, keeps it «En revisión» and remembers its data, buttons and time-to-live", async () => {
    const channel = await metaChannel();
    const owner = await createUser("owner");
    meta(() => metaJson({ id: "600000000000099", status: "PENDING", category: "UTILITY" }));
    const created = await createWhatsAppTemplate(owner.actor, channel.id, reminder);
    expect(created).toMatchObject({ status: "PENDING", category: "UTILITY" });

    const body = metaCalls[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ name: "recordatorio_cita", category: "UTILITY", parameter_format: "NAMED", message_send_ttl_seconds: 3_600 });
    expect(JSON.stringify(body)).toContain('"example":"Fisioterapia Movimiento"');

    const [template] = await listWhatsAppTemplates(owner.actor, channel.id);
    expect(template).toMatchObject({
      status: "PENDING",
      createdInApp: true,
      requestedCategory: "UTILITY",
      ttlSeconds: 3_600,
      quickReplies: ["Confirmo", "Necesito cambiarla"],
      buttonRoles: { Confirmo: "confirm", "Necesito cambiarla": "change" },
      variableBindings: { nombre: "contact.name", dia: "booking.date", hora: "booking.time", profesional: "resource.name", negocio: "business.name" },
    });
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ action: "channel.template_created", targetId: channel.id });
  });

  it("[WA-60] approved in another category than asked: it says so and tells the owner and the admins", async () => {
    const channel = await metaChannel();
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    const supervisor = await createUser("supervisor");
    meta(() => metaJson({ id: "600000000000099", status: "APPROVED", category: "MARKETING" }));
    await createWhatsAppTemplate(owner.actor, channel.id, reminder);
    const [template] = await listWhatsAppTemplates(owner.actor, channel.id);
    expect(template).toMatchObject({ category: "MARKETING", requestedCategory: "UTILITY" });
    const notices = await db.select().from(notifications);
    const told = new Set(notices.map((notice) => notice.userId));
    expect(told.has(owner.userId) && told.has(admin.userId)).toBe(true);
    expect(told.has(supervisor.userId)).toBe(false);
    expect(new Set(notices.map((notice) => `${notice.event}: ${notice.title}`))).toEqual(new Set(["whatsapp_template: La plantilla «recordatorio_cita» es ahora de marketing"]));
  });

  it("Meta's refusal comes in Spanish, and nothing is stored", async () => {
    const channel = await metaChannel();
    const owner = await createUser("owner");
    meta(() => metaError(2388299));
    await expect(createWhatsAppTemplate(owner.actor, channel.id, reminder)).rejects.toMatchObject({ status: 400, message: "El texto no puede empezar ni terminar con un dato." });
    expect(await db.select().from(whatsappTemplates)).toHaveLength(0);
  });

  it("what Meta would refuse is said by field before calling it, and a name already used in that language too", async () => {
    const channel = await metaChannel();
    const owner = await createUser("owner");
    meta(() => metaJson({ id: "600000000000099", status: "PENDING", category: "UTILITY" }));
    await expect(createWhatsAppTemplate(owner.actor, channel.id, { ...reminder, name: "Con Espacios" })).rejects.toMatchObject({
      status: 400,
      fieldErrors: { name: ["Solo minúsculas, números y guiones bajos (_), sin espacios."] },
    });
    await createWhatsAppTemplate(owner.actor, channel.id, reminder);
    await expect(createWhatsAppTemplate(owner.actor, channel.id, reminder)).rejects.toMatchObject({ status: 400 });
    expect(metaCalls).toHaveLength(1);
  });

  it("[PER-04] only the owner and the admins; nobody else reaches Meta", async () => {
    const channel = await metaChannel();
    meta(() => metaJson({ id: "600000000000099", status: "PENDING", category: "UTILITY" }));
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      const person = await createUser(role, { channelIds: [channel.id] });
      await expect(createWhatsAppTemplate(person.actor, channel.id, reminder)).rejects.toMatchObject({ status: 403 });
    }
    expect(metaCalls).toHaveLength(0);
  });
});

describe("Nueva plantilla on a demo channel [ARR-25]", () => {
  it("is approved at once, without calling Meta", async () => {
    const channel = await createChannel({ type: "whatsapp", name: "WhatsApp demo", isDemo: true, status: "connected" });
    const fake = fakeMetaFetch(() => metaJson({}, 500));
    vi.stubGlobal("fetch", fake.fetch);
    const owner = await createUser("owner");
    expect(await createWhatsAppTemplate(owner.actor, channel.id, reminder)).toMatchObject({ status: "APPROVED", category: "UTILITY" });
    expect(fake.calls).toHaveLength(0);
  });

  it("[SEG-07] each person creates at most 20 an hour; the next one is refused before anything", async () => {
    const channel = await createChannel({ type: "whatsapp", name: "WhatsApp demo", isDemo: true, status: "connected" });
    const owner = await createUser("owner");
    for (let index = 0; index < 20; index += 1) await createWhatsAppTemplate(owner.actor, channel.id, { ...reminder, name: `recordatorio_${index}` });
    await expect(createWhatsAppTemplate(owner.actor, channel.id, { ...reminder, name: "recordatorio_20" })).rejects.toMatchObject({
      status: 429,
      userMessage: "Has creado muchas plantillas seguidas. Espera un rato antes de crear otra.",
    });
    expect(await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.name, "recordatorio_20"))).toEqual([]);
  });
});

describe("Nueva plantilla with YCloud [YC-07]", () => {
  it("goes to YCloud with numbered parameters and its WABA, and remembers each number's data", async () => {
    const channel = await createChannel({
      type: "whatsapp",
      connectionMode: "ycloud",
      name: "WhatsApp YCloud",
      status: "connected",
      wabaId: YC_TEST.wabaId,
      config: { ycloudPhoneNumber: YC_TEST.phoneNumber },
      secretsEnc: encryptYCloudSecrets({ apiKey: YC_TEST.apiKey, webhookSecret: YC_TEST.webhookSecret }),
    });
    const calls: YCloudCall[] = [];
    const service = fakeYCloudFetch(
      ycloudRoutes({
        "POST /whatsapp/templates": (call) => {
          calls.push(call);
          return ycOk({ wabaId: YC_TEST.wabaId, name: "recordatorio_cita", language: "es_ES", category: "UTILITY", status: "PENDING" });
        },
      }),
    );
    const owner = await createUser("owner");
    await createWhatsAppTemplate(owner.actor, channel.id, reminder, service.deps);
    expect(calls[0].body).toMatchObject({ wabaId: YC_TEST.wabaId, name: "recordatorio_cita", messageSendTtlSeconds: 3_600 });
    expect(JSON.stringify(calls[0].body)).toContain("{{1}}");
    const [template] = await listWhatsAppTemplates(owner.actor, channel.id);
    expect(template.variableBindings).toEqual({ "1": "contact.name", "2": "booking.date", "3": "booking.time", "4": "resource.name", "5": "business.name" });
  });
});

describe("after creating it, the syncs and the buttons [WA-58] [WA-60] [AGD-32]", () => {
  it("a sync keeps its data and buttons, notes a change of category and a rejection, and tells the managers", async () => {
    const channel = await metaChannel();
    const owner = await createUser("owner");
    meta(() => metaJson({ id: "600000000000099", status: "PENDING", category: "UTILITY" }));
    await createWhatsAppTemplate(owner.actor, channel.id, reminder);
    const [created] = await db.select().from(whatsappTemplates);

    // Not in the provider's list yet: a template just created stays.
    await storeWhatsAppTemplates(channel.id, []);
    expect(await db.select().from(whatsappTemplates)).toHaveLength(1);

    await storeWhatsAppTemplates(channel.id, [{ id: "600000000000099", name: "recordatorio_cita", language: "es_ES", category: "MARKETING", status: "APPROVED", components: created.components }]);
    const [moved] = await db.select().from(whatsappTemplates);
    expect(moved).toMatchObject({ category: "MARKETING", previousCategory: "UTILITY", buttonRoles: created.buttonRoles, variableBindings: created.variableBindings });
    expect(moved.categoryChangedAt).not.toBeNull();

    await storeWhatsAppTemplates(channel.id, [{ id: "600000000000099", name: "recordatorio_cita", language: "es_ES", category: "MARKETING", status: "REJECTED", rejectedReason: "INVALID_FORMAT", components: created.components }]);
    const titles = (await db.select().from(notifications)).map((notice) => notice.title);
    expect(titles).toContain("La plantilla «recordatorio_cita» es ahora de marketing");
    expect(titles).toContain("Meta ha rechazado la plantilla «recordatorio_cita»");
  });

  it("the buttons of a synced template get what they do by hand; one role per button, only its own buttons", async () => {
    const channel = await metaChannel();
    const owner = await createUser("owner");
    await storeWhatsAppTemplates(channel.id, [
      { id: "1", name: "ofertas", language: "es", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: "Novedades" }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Parar" }, { type: "QUICK_REPLY", text: "Más info" }] }] },
    ]);
    const [template] = await db.select().from(whatsappTemplates);
    await setTemplateButtonRoles(owner.actor, { templateId: template.id, roles: { Parar: "marketing_opt_out", "Más info": null } });
    expect((await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.id, template.id)))[0].buttonRoles).toEqual({ Parar: "marketing_opt_out" });
    await expect(setTemplateButtonRoles(owner.actor, { templateId: template.id, roles: { Otro: "confirm" } })).rejects.toMatchObject({ status: 400 });
    await expect(setTemplateButtonRoles(owner.actor, { templateId: template.id, roles: { Parar: "confirm", "Más info": "confirm" } })).rejects.toMatchObject({ status: 400 });
    const viewer = await createUser("viewer");
    await expect(setTemplateButtonRoles(viewer.actor, { templateId: template.id, roles: {} })).rejects.toMatchObject({ status: 403 });
  });
});
