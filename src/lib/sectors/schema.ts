// Shape of a sector preset: the editable starting data a sector loads into the database ([ASI-04], [AGD-27]).
// Presets are plain data shared by the setup wizard and the demo seed; nothing here touches the database.
import { z } from "zod";
import { AGENDA_MODES, RESOURCE_COLORS, RESOURCE_TYPES, SECTORS } from "@/lib/enums";

const MINUTES_PER_DAY = 24 * 60;
/** Slot steps the agenda offers ([AGD-08]). */
export const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60] as const;

/** Words of [AGD-01]: singular and plural of each option. */
export const TERMINOLOGY_OPTIONS = {
  booking: [
    { singular: "cita", plural: "citas" },
    { singular: "reserva", plural: "reservas" },
  ],
  resource: [
    { singular: "profesional", plural: "profesionales" },
    { singular: "mesa", plural: "mesas" },
    { singular: "sala", plural: "salas" },
    { singular: "box", plural: "boxes" },
  ],
  customer: [
    { singular: "cliente", plural: "clientes" },
    { singular: "paciente", plural: "pacientes" },
    { singular: "comensal", plural: "comensales" },
  ],
} as const;

const singulars = <const S extends string>(options: readonly { singular: S }[]): S[] => options.map((o) => o.singular);
const pluralOf = (options: readonly { singular: string; plural: string }[], singular: string) =>
  options.find((o) => o.singular === singular)?.plural;

/** Data key inside a preset (lower-case words joined by hyphens), used to link services, resources and demo data. */
export const presetKeySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Clave no válida.");

const minuteOfDay = z.number().int().min(0).max(MINUTES_PER_DAY);

/** One weekly range in local minutes from 00:00. weekday: 1 = Monday … 7 = Sunday (as in the database). */
export const weeklyRangeSchema = z
  .object({ weekday: z.number().int().min(1).max(7), startMin: minuteOfDay, endMin: minuteOfDay })
  .refine((range) => range.startMin < range.endMin, "El tramo termina antes de empezar.");
export type WeeklyRange = z.infer<typeof weeklyRangeSchema>;

export const terminologySchema = z
  .object({
    booking: z.enum(singulars(TERMINOLOGY_OPTIONS.booking)),
    bookings: z.string(),
    resource: z.enum(singulars(TERMINOLOGY_OPTIONS.resource)),
    resources: z.string(),
    customer: z.enum(singulars(TERMINOLOGY_OPTIONS.customer)),
  })
  .refine(
    (t) =>
      t.bookings === pluralOf(TERMINOLOGY_OPTIONS.booking, t.booking) &&
      t.resources === pluralOf(TERMINOLOGY_OPTIONS.resource, t.resource),
    "El plural no corresponde a la palabra elegida.",
  );
export type SectorTerminology = z.infer<typeof terminologySchema>;

export const presetResourceSchema = z.object({
  key: presetKeySchema,
  type: z.enum(RESOURCE_TYPES),
  name: z.string().trim().min(1).max(80),
  color: z.enum(RESOURCE_COLORS),
  capacity: z.number().int().min(1).max(500),
  schedule: z.array(weeklyRangeSchema).min(1),
});
export type PresetResource = z.infer<typeof presetResourceSchema>;

export const presetServiceSchema = z
  .object({
    key: presetKeySchema,
    name: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(40),
    durationMin: z.number().int().min(5).max(MINUTES_PER_DAY),
    bufferBeforeMin: z.number().int().min(0).max(240),
    bufferAfterMin: z.number().int().min(0).max(240),
    /**
     * Indicative price ([AGD-04]). Presets leave it empty: the agent quotes it, so only the business sets it
     * (the demo seed adds example prices to its fictional business).
     */
    price: z.number().nonnegative().optional(),
    descriptionForAgent: z.string().trim().min(1).max(1000),
    minPeople: z.number().int().min(1),
    maxPeople: z.number().int().min(1),
    minAdvanceMin: z.number().int().min(0),
    maxAdvanceDays: z.number().int().min(1).nullable(),
    requiresManualConfirmation: z.boolean(),
    /** Resources that can do it (at least one). */
    resourceKeys: z.array(presetKeySchema).min(1),
  })
  .refine((service) => service.minPeople <= service.maxPeople, "Mínimo de personas mayor que el máximo.");
export type PresetService = z.infer<typeof presetServiceSchema>;

const instructionText = z.string().trim().min(1).max(4000);

/** Starting agent of the sector ([AGE-02], [AGE-04], [AGE-09]); maps onto the agents table. */
export const agentTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  tone: z.string().trim().min(1).max(80),
  instructions: z.object({
    role: instructionText,
    businessInfo: instructionText,
    can: instructionText,
    cannot: instructionText,
    style: instructionText,
    handoff: instructionText,
  }),
  handoff: z.object({
    keywords: z.array(z.string().trim().min(1)).min(1),
    sensitiveTopics: z.array(z.string().trim().min(1)),
    /** «No lo sé» answers before handing off. */
    unknownThreshold: z.number().int().min(1).max(5),
    messageInHours: z.string().trim().min(1).max(500),
    messageOffHours: z.string().trim().min(1).max(500),
  }),
});
export type AgentTemplate = z.infer<typeof agentTemplateSchema>;

export const faqSchema = z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(2000),
});
export type Faq = z.infer<typeof faqSchema>;

function isInside(range: WeeklyRange, hours: readonly WeeklyRange[]): boolean {
  return hours.some((h) => h.weekday === range.weekday && h.startMin <= range.startMin && range.endMin <= h.endMin);
}

function duplicates(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

export const sectorPresetSchema = z
  .object({
    slug: z.enum(SECTORS),
    /** Name on the setup wizard card ([ASI-03]). */
    label: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(200),
    /** Health data sector: the wizard and Settings warn about it ([ASI-05], [CUM-12]). */
    healthData: z.boolean(),
    agendaMode: z.enum(AGENDA_MODES),
    slotIntervalMin: z.literal(SLOT_INTERVALS),
    terminology: terminologySchema,
    /** Suggested opening hours; business hours limit every resource ([AGD-05]). */
    businessHours: z.array(weeklyRangeSchema).min(1),
    resources: z.array(presetResourceSchema).min(1),
    services: z.array(presetServiceSchema).min(1),
    agentTemplate: agentTemplateSchema,
    faqs: z.array(faqSchema).min(3),
  })
  .superRefine((preset, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const resourceKeys = preset.resources.map((r) => r.key);
    for (const key of duplicates(resourceKeys)) issue(`Recurso repetido: ${key}.`);
    for (const key of duplicates(preset.services.map((s) => s.key))) issue(`Servicio repetido: ${key}.`);
    for (const resource of preset.resources) {
      if (!resource.schedule.every((range) => isInside(range, preset.businessHours))) {
        issue(`El horario de ${resource.key} sale del horario del negocio.`);
      }
      if (preset.agendaMode === "individual" && resource.capacity !== 1) {
        issue(`En modo individual cada recurso tiene capacidad 1 (${resource.key}).`);
      }
    }
    for (const service of preset.services) {
      const linked = preset.resources.filter((r) => service.resourceKeys.includes(r.key));
      if (linked.length !== service.resourceKeys.length) issue(`${service.key} usa un recurso que no existe.`);
      const maxCapacity = Math.max(0, ...linked.map((r) => r.capacity));
      if (service.maxPeople > maxCapacity) issue(`${service.key} admite más personas que sus recursos.`);
    }
    const unused = resourceKeys.filter((key) => !preset.services.some((s) => s.resourceKeys.includes(key)));
    for (const key of unused) issue(`El recurso ${key} no hace ningún servicio.`);
  });
export type SectorPreset = z.infer<typeof sectorPresetSchema>;
