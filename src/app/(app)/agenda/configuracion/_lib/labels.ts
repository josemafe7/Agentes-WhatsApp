// Spanish labels of the agenda configuration ([AGD-02], [AGD-06]) and the names of the 8 resource colours of DESIGN.md
// («Colores de recurso»; their classes are in src/lib/booking-display.ts).
import type { AgendaMode, ResourceColor, ResourceType } from "@/lib/enums";

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  person: "Persona",
  room: "Sala o box",
  table: "Mesa o zona",
  equipment: "Equipo",
};

export const RESOURCE_COLOR_LABELS: Record<ResourceColor, string> = {
  blue: "Azul",
  violet: "Violeta",
  pink: "Rosa",
  orange: "Naranja",
  amber: "Ámbar",
  emerald: "Esmeralda",
  teal: "Verde azulado",
  gray: "Gris",
};

export const AGENDA_MODE_OPTIONS: { value: AgendaMode; label: string; description: string }[] = [
  {
    value: "individual",
    label: "Por recurso individual",
    description: "Cada profesional, sala o box atiende una cita a la vez. Para peluquería, clínica, fisioterapia o taller.",
  },
  {
    value: "capacity",
    label: "Por aforo",
    description:
      "Cada recurso admite varias reservas a la vez mientras la suma de personas no pase de su capacidad. Para restaurantes por mesas o por aforo y para clases: la duración de la mesa es la de cada servicio y el tamaño del grupo, sus personas mínimas y máximas.",
  },
];

/** «profesionales» → «Profesionales». */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
