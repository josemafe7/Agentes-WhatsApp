// Ajustes › WhatsApp «Tarifas» ([AJU-09], [AJU-15], [WA-47]): the Server Actions called directly, as an attacker could
// ([SEG-04]). The session is replaced; the data layer and the database are real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, pricingRates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { actorFor, createBusiness } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { deletePricingRateAction, savePricingRateAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };

const rates = () => db.select().from(pricingRates);

beforeEach(async () => {
  await db.delete(pricingRates);
  await db.delete(auditLog);
  await createBusiness();
  state.actor = actorFor("owner");
});

describe("Tarifas de WhatsApp [AJU-09] [WA-47]", () => {
  it("saves a rate per market and category, in US dollars, never as an example", async () => {
    const result = await savePricingRateAction({ country: "es", category: "utility", price: "0,0509" });
    expect(result).toMatchObject({ ok: true, message: "Tarifa guardada: Utilidad en España." });
    expect(await rates()).toEqual([expect.objectContaining({ channelType: "whatsapp", country: "ES", category: "utility", price: 0.0509, currency: "USD", isExample: false })]);
    const [entry] = await db.select().from(auditLog);
    expect(entry.action).toBe("settings.pricing_rate_saved");
  });

  it("the same market and category replace the old rate; a demo example becomes the business's own", async () => {
    const now = new Date();
    await db.insert(pricingRates).values({ channelType: "whatsapp", country: "ES", category: "marketing", price: 0.01, currency: "USD", isExample: true, createdAt: now, updatedAt: now });
    expect(await savePricingRateAction({ country: "ES", category: "marketing", price: "0.0615" })).toMatchObject({ ok: true });
    expect(await rates()).toEqual([expect.objectContaining({ country: "ES", category: "marketing", price: 0.0615, isExample: false })]);
  });

  it("a wrong value is not saved and its error goes next to its field [AJU-15]", async () => {
    expect(await savePricingRateAction({ country: "España", category: "utility", price: "0,05" })).toMatchObject({
      ok: false,
      fieldErrors: { country: ["Escribe el código de país de dos letras (por ejemplo, ES)."] },
    });
    expect(await savePricingRateAction({ country: "ES", category: "gratis", price: "0,05" })).toMatchObject({ ok: false, fieldErrors: { category: ["Elige una categoría de Meta."] } });
    expect(await savePricingRateAction({ country: "ES", category: "utility", price: "" })).toMatchObject({ ok: false, fieldErrors: { price: ["Escribe el precio."] } });
    expect(await savePricingRateAction({ country: "ES", category: "utility", price: "cinco" })).toMatchObject({
      ok: false,
      fieldErrors: { price: ["Escribe el precio con números, como 0,0509."] },
    });
    expect(await savePricingRateAction({ country: "ES", category: "utility", price: "-1" })).toMatchObject({ ok: false, fieldErrors: { price: expect.any(Array) } });
    expect(await savePricingRateAction({ country: "ES", category: "utility", price: "500" })).toMatchObject({ ok: false, fieldErrors: { price: ["Como mucho 100 US$ por mensaje."] } });
    expect(await savePricingRateAction("no es un formulario")).toMatchObject({ ok: false });
    expect(await rates()).toHaveLength(0);
  });

  it("deletes a rate: that market is no longer estimated", async () => {
    await savePricingRateAction({ country: "MX", category: "service", price: "0,0085" });
    const [rate] = await rates();
    expect(await deletePricingRateAction(rate.id)).toMatchObject({ ok: true, message: "Tarifa borrada." });
    expect(await rates()).toHaveLength(0);
    expect(await deletePricingRateAction(rate.id)).toMatchObject({ ok: false });
    expect(await deletePricingRateAction("no-es-un-id")).toMatchObject({ ok: false });
  });
});

describe("permisos de Tarifas [PER-04] [PER-03] [SEG-04]", () => {
  it.each<Role>(["admin"])("%s manages the rates too", async (role) => {
    state.actor = actorFor(role);
    expect(await savePricingRateAction({ country: "ES", category: "utility", price: "0,05" })).toMatchObject({ ok: true });
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot save or delete a rate, and nothing changes", async (role) => {
    await savePricingRateAction({ country: "ES", category: "utility", price: "0,05" });
    const before = await rates();
    state.actor = actorFor(role);
    expect(await savePricingRateAction({ country: "ES", category: "utility", price: "9" })).toEqual(FORBIDDEN);
    expect(await savePricingRateAction({ country: "FR", category: "utility", price: "9" })).toEqual(FORBIDDEN);
    expect(await deletePricingRateAction(before[0].id)).toEqual(FORBIDDEN);
    expect(await rates()).toEqual(before);
  });

  it("without a session nothing is saved", async () => {
    state.actor = null;
    expect(await savePricingRateAction({ country: "ES", category: "utility", price: "0,05" })).toMatchObject({ ok: false });
    expect(await rates()).toHaveLength(0);
  });
});
