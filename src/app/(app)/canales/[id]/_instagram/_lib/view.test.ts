// What the Instagram panel shows ([IG-09], [IG-10]): lights in order, dates as people read them and the token's validity.
import { describe, expect, it } from "vitest";
import type { ChannelHealth } from "@/db/schema";
import { instagramLights, instagramReviewNote, readableDetail, tokenValidity } from "./view";

const TZ = "Europe/Madrid";
const NOW = new Date("2026-10-16T10:00:00Z");

const health: ChannelHealth = {
  checkedAt: NOW.toISOString(),
  checks: [
    { key: "token", status: "ok", detail: "Cuenta @peluqueria_aurora conectada." },
    { key: "expiry", status: "ok", detail: "Vale hasta el 2026-12-15T10:00:00.000Z; la app lo renueva sola cada semana." },
    { key: "receiving", status: "warn", detail: "Meta aún no ha comprobado la dirección de avisos." },
    { key: "last_message", status: "off", detail: "Aún no ha llegado ningún mensaje." },
  ],
};

describe("the Instagram panel's lights [IG-10]", () => {
  it("shows token, its expiry, receiving and the last message, in order, with the dates in the business time zone", () => {
    const lights = instagramLights(health, { lastInboundAt: new Date("2026-10-16T08:00:00Z"), timezone: TZ, now: NOW, mode: "instagram" });
    expect(lights.map((light) => [light.label, light.status])).toEqual([
      ["Token", "ok"],
      ["Caducidad del token", "ok"],
      ["Recepción", "warn"],
      ["Último mensaje", "off"],
    ]);
    expect(lights[1].detail).toBe("Vale hasta el 15 dic 2026, 11:00; la app lo renueva sola cada semana.");
    expect(lights[3].detail).toBe("16 oct 2026, 10:00 (hace 2 h)");
  });

  it("a demo or disconnected account says why it is not checked; before the first check, when it will be", () => {
    const demo = instagramLights(health, { lastInboundAt: null, timezone: TZ, now: NOW, mode: "demo" });
    expect(demo[0]).toMatchObject({ status: "off", detail: "Canal de demostración: no se comprueba con Instagram." });
    expect(instagramReviewNote({ mode: "disconnected", lastHealthAt: null, timezone: TZ })).toBe("Cuenta desconectada: no se revisa con Instagram.");
    expect(instagramLights(null, { lastInboundAt: null, timezone: TZ, now: NOW, mode: "instagram" })[0].detail).toMatch(/cada 6 horas o al pulsar «Revalidar»/);
    expect(instagramReviewNote({ mode: "instagram", lastHealthAt: NOW, timezone: TZ })).toMatch(/^Última revisión: 16 oct 2026, 12:00\. Se revisa sola cada 6 horas/);
  });

  it("leaves a text without dates as it is", () => {
    expect(readableDetail("Cuenta @peluqueria_aurora conectada.", TZ)).toBe("Cuenta @peluqueria_aurora conectada.");
  });
});

describe("until when the token lasts [IG-09]", () => {
  it("says until when, how many days are left and that the app renews it every week", () => {
    expect(tokenValidity(new Date("2026-12-15T10:00:00Z"), { timezone: TZ, now: NOW })).toEqual({
      text: "Vale hasta el 15 dic 2026, 11:00 · quedan 60 días. La app lo renueva sola cada semana.",
      expired: false,
    });
    expect(tokenValidity(new Date("2026-10-17T09:00:00Z"), { timezone: TZ, now: NOW }).text).toMatch(/· queda menos de 1 día\./);
    expect(tokenValidity(new Date("2026-10-17T11:00:00Z"), { timezone: TZ, now: NOW }).text).toMatch(/· queda 1 día\./);
  });

  it("an expired token says how to replace it", () => {
    expect(tokenValidity(new Date("2026-10-15T10:00:00Z"), { timezone: TZ, now: NOW })).toEqual({
      text: "Caducó el 15 oct 2026, 12:00. Genera uno nuevo en tu app de Meta y pulsa «Cambiar token».",
      expired: true,
    });
  });
});
