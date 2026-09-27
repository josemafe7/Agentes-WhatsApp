// Paso 0, «Número de prueba de Meta» ([WA-03]): Meta's test number comes registered and needs no payment method, so the
// wizard skips its verification, its registration and the payment check, and the number's panel reminds that only the
// recipients verified in Meta get messages. The data layer and the database are real; Meta is the documented fake.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getChannel } from "@/data/channels";
import { getWhatsAppPanel } from "@/data/whatsapp-panel";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { encryptWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { checkWhatsAppHealth } from "@/server/channels/whatsapp/health";
import { actorFor, createBusiness, createChannel } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import { connectedNumberRoutes, FAKE_META_BASE_URL, fakeMetaFetch } from "@/test/fixtures/whatsapp/fake-meta";
import { ActivateStep } from "../../nuevo/whatsapp/_components/activate-step";
import { WhatsAppPanel } from "./whatsapp-panel";

const owner = actorFor("owner");
const TZ = "Europe/Madrid";

const whatsappChannel = (isMetaTestNumber: boolean) =>
  createChannel({
    type: "whatsapp",
    name: isMetaTestNumber ? "Número de prueba" : "WhatsApp del negocio",
    status: "connected",
    phoneNumberId: isMetaTestNumber ? WA_TEST.phoneNumberId : "200000000000777",
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    isMetaTestNumber,
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
  });

/** The step as the wizard renders it (inside the app's TooltipProvider). */
const activateStep = (isMetaTestNumber: boolean) =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ActivateStep, {
      channelId: crypto.randomUUID(),
      isMetaTestNumber,
      hasPin: false,
      register: { left: 10, nextFreeAt: null },
      appLiveConfirmed: false,
      paymentConfirmed: false,
      templates: 0,
      legalUrls: { terms: "https://negocio.test/legal/terminos", privacy: "https://negocio.test/legal/privacidad", deletion: "https://negocio.test/legal/eliminacion-datos" },
      timezone: TZ,
      backHref: "/canales/nuevo/whatsapp",
      nextHref: "/canales/nuevo/whatsapp",
      }),
    ),
  );

beforeEach(async () => {
  await db.delete(channels);
  await createBusiness();
});

describe("Meta's test number [WA-03]", () => {
  it("the activation step asks nothing of Meta: no verification, no registration and no payment method", () => {
    const html = activateStep(true);
    expect(html).toContain("Número de prueba de Meta");
    expect(html).toContain("no hace falta verificarlo, registrarlo ni añadir un método de pago");
    expect(html).toContain("solo reciben mensajes los");
    expect(html).not.toContain("Activar el número");
    expect(html).not.toContain("Método de pago en WhatsApp Manager");
    // A number of the business goes through its activation and the payment check ([WA-17], [WA-21]).
    const business = activateStep(false);
    expect(business).toContain("Activar el número");
    expect(business).toContain("Método de pago en WhatsApp Manager");
  });

  it("the channel remembers it, and its lights never ask for the payment method", async () => {
    const test = await whatsappChannel(true);
    const business = await whatsappChannel(false);
    expect((await getWhatsAppPanel(owner, test.id)).isMetaTestNumber).toBe(true);
    const deps = { fetchImpl: fakeMetaFetch(connectedNumberRoutes()).fetch, baseUrl: FAKE_META_BASE_URL };
    const paymentOf = async (id: string) => {
      const [row] = await db.select().from(channels).where(eq(channels.id, id));
      return (await checkWhatsAppHealth(row, deps)).health.checks.find((check) => check.key === "payment");
    };
    expect(await paymentOf(test.id)).toMatchObject({ status: "ok" });
    expect(await paymentOf(business.id)).toMatchObject({ status: "warn", detail: "Confirma que has añadido el método de pago en WhatsApp Manager." });
  });

  it("the number's panel reminds that only the recipients verified in Meta get messages", async () => {
    const test = await whatsappChannel(true);
    const html = renderToStaticMarkup(await WhatsAppPanel({ actor: owner, channel: await getChannel(owner, test.id), canManage: true, timezone: TZ }));
    expect(html).toContain("Número de prueba de Meta");
    expect(html).toContain("Solo reciben mensajes los destinatarios verificados");
    const business = await whatsappChannel(false);
    const other = renderToStaticMarkup(await WhatsAppPanel({ actor: owner, channel: await getChannel(owner, business.id), canManage: true, timezone: TZ }));
    expect(other).not.toContain("Solo reciben mensajes los destinatarios verificados");
  });
});
