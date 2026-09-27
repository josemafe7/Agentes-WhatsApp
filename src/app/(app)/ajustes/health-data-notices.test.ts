// [CUM-12] In the sectors with health data (Clínica dental and Clínica/Fisioterapia), Ajustes › Negocio and Ajustes ›
// Privacidad y legal warn that they are specially protected data and recommend «Sin retención de datos», a shorter
// retention, the data processing contract and no diagnoses by chat. The pages are rendered as a person sees them; only the
// session is replaced.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECTORS, type Sector } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { actorFor, createBusiness } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/server/session", () => ({
  requirePageActor: async () => {
    if (!state.actor) throw new Error("sin sesión");
    return state.actor;
  },
}));

import BusinessSettingsPage from "./negocio/page";
import PrivacySettingsPage from "./privacidad/page";

const RECOMMENDATIONS = [/Sin retención de datos/, /acortar (los plazos de conservación|la conservación)/, /firmar el contrato de encargo del tratamiento/, /no pedir diagnósticos por chat/];

const negocio = async () => renderToStaticMarkup(await BusinessSettingsPage());
const privacidad = async () => renderToStaticMarkup(await PrivacySettingsPage());

beforeEach(() => {
  state.actor = actorFor("owner");
});

describe("health data notices [CUM-12] [ASI-05]", () => {
  it("only Clínica dental and Clínica/Fisioterapia handle health data", () => {
    expect(SECTORS.filter((sector) => getSectorPreset(sector).healthData)).toEqual(["clinica-dental", "fisioterapia"]);
  });

  it.each<Sector>(["clinica-dental", "fisioterapia"])("%s: Negocio and Privacidad warn and give the four recommendations", async (sector) => {
    await createBusiness({ sector });
    const business = await negocio();
    expect(business).toContain("datos de salud");
    expect(business).toContain("protege especialmente");
    const privacy = await privacidad();
    expect(privacy).toContain("Tu negocio trata datos de salud");
    expect(privacy).toContain("especialmente protegidos");
    for (const recommendation of RECOMMENDATIONS) {
      expect(business, String(recommendation)).toMatch(recommendation);
      expect(privacy, String(recommendation)).toMatch(recommendation);
    }
  });

  it("another sector sees no such warning", async () => {
    await createBusiness({ sector: "peluqueria" });
    expect(await negocio()).not.toContain("datos de salud");
    expect(await privacidad()).not.toContain("datos de salud");
  });
});
