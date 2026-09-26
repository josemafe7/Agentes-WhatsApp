// Sector presets ([ASI-03], [ASI-04], [AGD-27], [AGE-02]): editable starting data for every sector of the spec.
// The setup wizard and the demo seed load them into the database; after that the business edits its own copy.
import { SECTORS, type Sector } from "@/lib/enums";
import { academia } from "./academia";
import { clinicaDental } from "./clinica-dental";
import { fisioterapia } from "./fisioterapia";
import { inmobiliaria } from "./inmobiliaria";
import { otro } from "./otro";
import { peluqueria } from "./peluqueria";
import { restaurante } from "./restaurante";
import type { SectorPreset } from "./schema";
import { taller } from "./taller";
import { tienda } from "./tienda";

export * from "./schema";

export const SECTOR_PRESETS: Readonly<Record<Sector, SectorPreset>> = {
  peluqueria,
  "clinica-dental": clinicaDental,
  fisioterapia,
  restaurante,
  taller,
  academia,
  inmobiliaria,
  tienda,
  otro,
};

/** The sector used when none is chosen (the demo is a hair salon, [ARR-06]). */
export const DEFAULT_SECTOR: Sector = "peluqueria";

export function isSector(value: string): value is Sector {
  return (SECTORS as readonly string[]).includes(value);
}

export function getSectorPreset(sector: Sector): SectorPreset {
  return SECTOR_PRESETS[sector];
}

/** What the setup wizard shows on each sector card, in the order of [ASI-03]. */
export const SECTOR_OPTIONS = SECTORS.map((slug) => {
  const { label, description, healthData } = SECTOR_PRESETS[slug];
  return { slug, label, description, healthData };
});

/** Spanish error for an unknown sector, listing the valid ones ([ARR-10]). */
export function unknownSectorMessage(value: string): string {
  return `El sector «${value}» no existe. Sectores válidos: ${SECTORS.join(", ")}.`;
}
