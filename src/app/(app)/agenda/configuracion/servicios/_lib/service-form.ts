// What the service form turns the typed text into ([AGD-04]). The server validates it again with the same rules and
// explains each error by its field ([AJU-15]); a value that is not a number goes as written so it gets its message.

export const ADVANCE_UNITS = ["minutes", "hours", "days"] as const;
export type AdvanceUnit = (typeof ADVANCE_UNITS)[number];

export const ADVANCE_UNIT_LABELS: Record<AdvanceUnit, string> = { minutes: "minutos", hours: "horas", days: "días" };
const UNIT_MINUTES: Record<AdvanceUnit, number> = { minutes: 1, hours: 60, days: 1_440 };
const DECIMAL = /^\d+(?:[.,]\d+)?$/;

/** "18,50" → 18.5; empty → null; anything else stays as written (the server rejects it by the field). */
export function parseNumberField(text: string): number | null | string {
  const value = text.trim();
  if (value === "") return null;
  return DECIMAL.test(value) ? Number(value.replace(",", ".")) : text;
}

/** Minimum notice typed as an amount and a unit → minutes (empty = no minimum). */
export function advanceToMinutes(amount: string, unit: AdvanceUnit): number | string {
  const value = parseNumberField(amount);
  if (value === null) return 0;
  return typeof value === "number" ? Math.round(value * UNIT_MINUTES[unit]) : value;
}

/** Minutes → the largest whole unit, to show a saved notice back («2 horas», «1 días»). */
export function minutesToAdvance(minutes: number): { amount: string; unit: AdvanceUnit } {
  if (minutes === 0) return { amount: "0", unit: "hours" };
  if (minutes % UNIT_MINUTES.days === 0) return { amount: String(minutes / UNIT_MINUTES.days), unit: "days" };
  if (minutes % UNIT_MINUTES.hours === 0) return { amount: String(minutes / UNIT_MINUTES.hours), unit: "hours" };
  return { amount: String(minutes), unit: "minutes" };
}

/** 90 → «1 h 30 min». */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * What would leave the service without slots ([AGD-11], [AGD-12]): nobody who does it, or a largest group that fits in
 * none of the chosen resources.
 */
export function serviceWarnings(input: { maxPeople: number; resources: readonly { capacity: number }[] }): string[] {
  if (input.resources.length === 0) return ["Sin nadie que lo haga, este servicio no tendrá huecos."];
  const largest = Math.max(...input.resources.map((resource) => resource.capacity));
  if (input.maxPeople > largest) {
    return [`Ninguno de los elegidos admite ${input.maxPeople} personas a la vez: los grupos de más de ${largest} no tendrán huecos.`];
  }
  return [];
}
