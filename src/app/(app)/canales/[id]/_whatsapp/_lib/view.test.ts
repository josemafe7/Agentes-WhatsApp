import { describe, expect, it } from "vitest";
import type { ChannelHealth } from "@/db/schema";
import type { WhatsAppAccountNotice } from "@/data/whatsapp-account-alerts";
import {
  accountNoticeView,
  healthLights,
  healthReviewNote,
  messagingLimitLabel,
  templateCategoryLabel,
  templateStatusView,
  TEST_ALLOWLIST_HELP,
} from "./view";

const NOW = new Date("2026-09-27T10:00:00Z");
const TZ = "Europe/Madrid";

function notice(overrides: Partial<WhatsAppAccountNotice>): WhatsAppAccountNotice {
  return { id: "n1", receivedAt: NOW, field: "account_update", event: null, subject: null, metaText: null, ...overrides };
}

describe("semáforos del panel de WhatsApp [WA-26]", () => {
  const health: ChannelHealth = {
    checkedAt: "2026-09-27T08:00:00.000Z",
    checks: [
      { key: "version", status: "ok", detail: "Versión v26.0, sin fecha de fin." },
      { key: "token", status: "warn", detail: "El token caduca el 2026-10-10. Crea uno permanente." },
      { key: "registration", status: "ok", detail: "Número registrado y conectado." },
      { key: "subscription", status: "error", detail: "La app no está suscrita a la cuenta de WhatsApp Business: no llegarán mensajes. Pulsa «Revalidar»." },
      { key: "webhook", status: "ok", detail: "Último aviso de Meta: 2026-09-27." },
      { key: "last_message", status: "off", detail: "Último mensaje recibido: 2026-09-20." },
      { key: "quality", status: "ok", detail: "Calidad alta." },
      { key: "name", status: "warn", detail: "El nombre está pendiente de revisión: hasta entonces solo se ve en el perfil." },
      { key: "limit", status: "off", detail: "Límite de mensajes del portfolio (compartido con sus otros números): TIER_250." },
      { key: "send", status: "ok", detail: "El número puede enviar mensajes." },
      { key: "payment", status: "ok", detail: "Sin errores de pago." },
    ],
  };

  it("shows token, registro, suscripción, avisos, último mensaje, calidad, nombre, límite and versión, in that order, with their Spanish explanation", () => {
    const lights = healthLights(health, { lastInboundAt: null, messagingLimit: null, timezone: TZ, now: NOW });
    expect(lights.map((light) => light.label)).toEqual([
      "Token",
      "Registro",
      "Suscripción",
      "Avisos",
      "Último mensaje",
      "Calidad",
      "Nombre",
      "Límite de mensajes",
      "Envío",
      "Método de pago",
      "Versión de la API",
    ]);
    expect(lights.find((light) => light.key === "token")).toMatchObject({ status: "warn", detail: "El token caduca el 2026-10-10. Crea uno permanente." });
    expect(lights.find((light) => light.key === "subscription")?.status).toBe("error");
  });

  it("the last message comes from the channel itself, not from the last check", () => {
    const lights = healthLights(health, { lastInboundAt: new Date("2026-09-27T09:55:00Z"), messagingLimit: null, timezone: TZ, now: NOW });
    const last = lights.find((light) => light.key === "last_message");
    expect(last?.status).toBe("off");
    expect(last?.detail).toContain("hace 5 min");
  });

  it("the messaging limit is the portfolio's, shared with its other numbers, in words [WA-30] [WA-48]", () => {
    const lights = healthLights(health, { lastInboundAt: null, messagingLimit: "TIER_2K", timezone: TZ, now: NOW });
    expect(lights.find((light) => light.key === "limit")).toMatchObject({
      status: "off",
      detail: "Es del portfolio y lo comparten todos sus números: 2.000 destinatarios cada 24 h.",
    });
  });

  it("before the first check every light is «Sin comprobar»", () => {
    const lights = healthLights(null, { lastInboundAt: null, messagingLimit: null, timezone: TZ, now: NOW });
    expect(lights).toHaveLength(11);
    expect(lights.filter((light) => light.key !== "last_message").every((light) => light.status === "off")).toBe(true);
    expect(lights[0].detail).toMatch(/todavía no se ha comprobado/i);
  });

  it("a check without credentials only has the token light: the others wait", () => {
    const lights = healthLights(
      { checkedAt: NOW.toISOString(), checks: [{ key: "token", status: "error", detail: "Faltan las credenciales de este número de WhatsApp. Vuelve a conectarlo." }] },
      { lastInboundAt: null, messagingLimit: null, timezone: TZ, now: NOW },
    );
    expect(lights[0]).toMatchObject({ key: "token", status: "error" });
    expect(lights.find((light) => light.key === "quality")?.status).toBe("off");
  });
});

describe("semáforos de un número desconectado o de demostración [WA-26] [WA-28]", () => {
  const green: ChannelHealth = {
    checkedAt: "2026-09-27T08:00:00.000Z",
    checks: [
      { key: "token", status: "ok", detail: "Token permanente con los permisos de WhatsApp." },
      { key: "registration", status: "ok", detail: "Número registrado y conectado." },
      { key: "subscription", status: "ok", detail: "La app está suscrita a la cuenta de WhatsApp Business." },
    ],
  };
  const context = { lastInboundAt: new Date("2026-09-27T09:55:00Z"), messagingLimit: "TIER_250", timezone: TZ, now: NOW };

  it("after «Desconectar», the last check no longer shows green: nothing is checked with Meta", () => {
    const lights = healthLights(green, { ...context, mode: "disconnected" });
    for (const key of ["token", "registration", "subscription", "quality"] as const) {
      expect(lights.find((light) => light.key === key)).toMatchObject({ status: "off", detail: "Número desconectado: no se comprueba con Meta." });
    }
    // What the channel itself knows stays.
    expect(lights.find((light) => light.key === "last_message")?.detail).toContain("hace 5 min");
    expect(healthReviewNote({ mode: "disconnected", lastHealthAt: new Date("2026-09-27T08:00:00Z"), timezone: TZ })).toBe("Número desconectado: no se revisa con Meta.");
  });

  it("a demo channel says so instead of promising checks and «Revalidar» it does not have", () => {
    const lights = healthLights(null, { ...context, mode: "demo" });
    expect(lights.find((light) => light.key === "token")).toMatchObject({ status: "off", detail: "Canal de demostración: no se comprueba con Meta." });
    expect(lights.map((light) => light.detail).join(" ")).not.toContain("Revalidar");
    expect(healthReviewNote({ mode: "demo", lastHealthAt: new Date("2026-09-27T08:00:00Z"), timezone: TZ })).toBe("Canal de demostración: no se revisa con Meta.");
  });

  it("a connected number keeps its last review and the 6-hour rhythm", () => {
    expect(healthReviewNote({ mode: "meta", lastHealthAt: new Date("2026-09-27T08:00:00Z"), timezone: TZ })).toMatch(/^Última revisión: .+\. Se revisa sola cada 6 horas/);
    expect(healthReviewNote({ mode: "meta", lastHealthAt: null, timezone: TZ })).toMatch(/^Todavía no se ha revisado con Meta\. Se revisa sola cada 6 horas/);
  });
});

describe("límites de Meta [WA-30] [WA-48]", () => {
  it.each([
    ["TIER_250", "250"],
    ["TIER_2K", "2.000"],
    ["TIER_10K", "10.000"],
    ["TIER_100K", "100.000"],
    ["2000", "2.000"],
  ])("%s means %s recipients in 24 h, worded as in the wizard", (tier, amount) => {
    expect(messagingLimitLabel(tier)).toBe(`${amount} destinatarios cada 24 h`);
  });

  it("unlimited and unknown values", () => {
    expect(messagingLimitLabel("TIER_UNLIMITED")).toBe("Sin límite");
    expect(messagingLimitLabel(null)).toBe("Sin datos");
    expect(messagingLimitLabel("TIER_RARO")).toBe("TIER_RARO");
  });
});

describe("plantillas [WA-22]", () => {
  it("status and category in Spanish, with their tone", () => {
    expect(templateStatusView("APPROVED")).toEqual({ label: "Aprobada", status: "ok" });
    expect(templateStatusView("PENDING")).toEqual({ label: "En revisión", status: "pending" });
    expect(templateStatusView("REJECTED")).toEqual({ label: "Rechazada", status: "error" });
    expect(templateStatusView("PAUSED")).toEqual({ label: "En pausa", status: "warn" });
    expect(templateStatusView(null)).toEqual({ label: "Sin estado", status: "off" });
    expect(templateStatusView("SOMETHING_NEW")).toEqual({ label: "SOMETHING_NEW", status: "off" });
    expect(templateCategoryLabel("UTILITY")).toBe("Utilidad");
    expect(templateCategoryLabel("marketing")).toBe("Marketing");
    expect(templateCategoryLabel("AUTHENTICATION")).toBe("Autenticación");
    expect(templateCategoryLabel(null)).toBe("Sin categoría");
  });
});

describe("avisos de Meta [WA-29]", () => {
  it("serious account events are errors, explained in Spanish", () => {
    expect(accountNoticeView(notice({ field: "account_update", event: "ACCOUNT_RESTRICTION" }))).toEqual({ title: "Meta ha restringido la cuenta", severity: "error" });
    expect(accountNoticeView(notice({ field: "account_update", event: "ACCOUNT_RECONNECTED" })).severity).toBe("info");
  });

  it("an approved name reminds to register again; a rejected one is an error [WA-20]", () => {
    expect(accountNoticeView(notice({ field: "phone_number_name_update", event: "APPROVED", subject: "Peluquería Ejemplo" }))).toEqual({
      title: "Meta ha aprobado el nombre «Peluquería Ejemplo»: vuelve a registrar el número en 14 días",
      severity: "warn",
    });
    expect(accountNoticeView(notice({ field: "phone_number_name_update", event: "REJECTED", subject: "Peluquería Ejemplo" })).severity).toBe("error");
  });

  it("Meta's alerts keep its severity; templates say which one", () => {
    expect(accountNoticeView(notice({ field: "account_alerts", event: "CRITICAL" })).severity).toBe("error");
    expect(accountNoticeView(notice({ field: "account_alerts", event: "WARNING" })).severity).toBe("warn");
    expect(accountNoticeView(notice({ field: "account_alerts", event: "INFORMATIONAL" })).severity).toBe("info");
    expect(accountNoticeView(notice({ field: "message_template_status_update", event: "REJECTED", subject: "oferta (es)" }))).toEqual({
      title: "Plantilla «oferta (es)»: rechazada",
      severity: "warn",
    });
    expect(accountNoticeView(notice({ field: "phone_number_quality_update", event: "THROUGHPUT_UPGRADE", subject: "TIER_2K" })).title).toBe(
      "Nuevo límite de mensajes: 2.000 destinatarios cada 24 h",
    );
    expect(accountNoticeView(notice({ field: "security", event: "PIN_CHANGED" })).severity).toBe("warn");
  });
});

describe("modo pruebas [CAN-06]", () => {
  it("explains that WhatsApp compares the number or the BSUID Meta gives", () => {
    expect(TEST_ALLOWLIST_HELP).toMatch(/BSUID/);
    expect(TEST_ALLOWLIST_HELP).toMatch(/\+34/);
  });
});
