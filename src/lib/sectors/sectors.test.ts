import { describe, expect, it } from "vitest";
import { SECTORS } from "@/lib/enums";
import {
  getSectorPreset,
  isSector,
  SECTOR_OPTIONS,
  SECTOR_PRESETS,
  sectorPresetSchema,
  TERMINOLOGY_OPTIONS,
  unknownSectorMessage,
} from "./index";

// The sector slugs written in docs/spec.md [ARR-10], in the order of [ASI-03].
const SPEC_SECTORS = [
  "peluqueria",
  "clinica-dental",
  "fisioterapia",
  "restaurante",
  "taller",
  "academia",
  "inmobiliaria",
  "tienda",
  "otro",
];
const SPEC_LABELS = [
  "Peluquería/Estética",
  "Clínica dental",
  "Clínica/Fisioterapia",
  "Restaurante",
  "Taller",
  "Academia/Clases",
  "Inmobiliaria",
  "Tienda",
  "Otro",
];
const presets = Object.values(SECTOR_PRESETS);

describe("sector presets", () => {
  it("[ARR-10] there is exactly one preset per sector of the spec, with the spec's slugs", () => {
    expect([...SECTORS]).toEqual(SPEC_SECTORS);
    expect(Object.keys(SECTOR_PRESETS).sort()).toEqual([...SPEC_SECTORS].sort());
    for (const slug of SPEC_SECTORS) expect(SECTOR_PRESETS[slug as keyof typeof SECTOR_PRESETS].slug).toBe(slug);
  });

  it("[ASI-03] the wizard cards show the spec's sector names in its order", () => {
    expect(SECTOR_OPTIONS.map((option) => option.label)).toEqual(SPEC_LABELS);
  });

  it.each(presets.map((preset) => [preset.slug, preset] as const))(
    "[ASI-04] %s validates against the preset schema",
    (_slug, preset) => {
      const result = sectorPresetSchema.safeParse(preset);
      expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toEqual([]);
    },
  );

  it("[ASI-04] the schema rejects inconsistent presets", () => {
    const base = getSectorPreset("peluqueria");
    const unknownResource = { ...base, services: [{ ...base.services[0], resourceKeys: ["nadie"] }] };
    const outsideHours = {
      ...base,
      resources: base.resources.map((r, i) => (i === 0 ? { ...r, schedule: [{ weekday: 1, startMin: 60, endMin: 120 }] } : r)),
    };
    const badPlural = { ...base, terminology: { ...base.terminology, bookings: "reservas" } };
    const capacityInIndividual = {
      ...base,
      resources: base.resources.map((r, i) => (i === 0 ? { ...r, capacity: 4 } : r)),
    };
    for (const invalid of [unknownResource, outsideHours, badPlural, capacityInIndividual]) {
      expect(sectorPresetSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("[AGD-06] individual mode for hair salon, dental, physio and garage; capacity for restaurant and classes", () => {
    const modes = Object.fromEntries(presets.map((p) => [p.slug, p.agendaMode]));
    expect(modes).toMatchObject({
      peluqueria: "individual",
      "clinica-dental": "individual",
      fisioterapia: "individual",
      taller: "individual",
      restaurante: "capacity",
      academia: "capacity",
    });
    for (const preset of presets.filter((p) => p.agendaMode === "capacity")) {
      expect(Math.max(...preset.resources.map((r) => r.capacity))).toBeGreaterThan(1);
    }
  });

  it("[ASI-04] Inmobiliaria and Tienda use the agenda of «Otro» with their own agent and questions", () => {
    const other = SECTOR_PRESETS.otro;
    for (const slug of ["inmobiliaria", "tienda"] as const) {
      const preset = SECTOR_PRESETS[slug];
      expect(preset.agendaMode).toBe(other.agendaMode);
      expect(preset.terminology).toEqual(other.terminology);
      expect(preset.services).toEqual(other.services);
      expect(preset.resources).toEqual(other.resources);
      expect(preset.agentTemplate.name).not.toBe(other.agentTemplate.name);
      expect(preset.faqs).not.toEqual(other.faqs);
    }
  });

  it("[ASI-05] only Clínica dental and Clínica/Fisioterapia are health-data sectors", () => {
    expect(presets.filter((p) => p.healthData).map((p) => p.slug).sort()).toEqual(["clinica-dental", "fisioterapia"]);
  });

  it("[AGD-01] terminology uses the spec's words, customers are patients in clinics and diners in restaurants", () => {
    const allowed = (list: readonly { singular: string }[]) => list.map((o) => o.singular);
    for (const preset of presets) {
      expect(allowed(TERMINOLOGY_OPTIONS.booking)).toContain(preset.terminology.booking);
      expect(allowed(TERMINOLOGY_OPTIONS.resource)).toContain(preset.terminology.resource);
      expect(allowed(TERMINOLOGY_OPTIONS.customer)).toContain(preset.terminology.customer);
    }
    expect(SECTOR_PRESETS["clinica-dental"].terminology.customer).toBe("paciente");
    expect(SECTOR_PRESETS.fisioterapia.terminology.customer).toBe("paciente");
    expect(SECTOR_PRESETS.restaurante.terminology).toMatchObject({ booking: "reserva", customer: "comensal" });
  });

  it("[AGE-02] [AGE-04] every sector has an agent template with the five guided instruction parts", () => {
    for (const preset of presets) {
      const { instructions } = preset.agentTemplate;
      for (const part of [instructions.role, instructions.businessInfo, instructions.can, instructions.cannot, instructions.style, instructions.handoff]) {
        expect(part.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it("[TRA-01] hand-off keywords never include a bare «persona», which appears in normal bookings", () => {
    for (const preset of presets) {
      expect(preset.agentTemplate.handoff.keywords).not.toContain("persona");
      expect(preset.agentTemplate.handoff.keywords).not.toContain("personas");
    }
  });

  it("presets carry no prices: only the business sets them (AGENTS.md: never fixed prices in code)", () => {
    for (const preset of presets) {
      for (const service of preset.services) expect(service.price).toBeUndefined();
    }
  });

  it("[ARR-10] unknown sectors are recognised and the error lists the valid ones", () => {
    expect(isSector("peluqueria")).toBe(true);
    expect(isSector("veterinaria")).toBe(false);
    const message = unknownSectorMessage("veterinaria");
    expect(message).toContain("veterinaria");
    for (const slug of SPEC_SECTORS) expect(message).toContain(slug);
  });
});
