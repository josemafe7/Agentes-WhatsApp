// Small helpers to write the sector presets readably (times as "HH:mm", repeated weekly ranges, defaults).
import type { PresetResource, PresetService, WeeklyRange } from "./schema";

export const MON = 1;
export const TUE = 2;
export const WED = 3;
export const THU = 4;
export const FRI = 5;
export const SAT = 6;
export const SUN = 7;
export const MON_TO_FRI = [MON, TUE, WED, THU, FRI] as const;

const MINUTES_PER_HOUR = 60;

/** "HH:mm" → minutes from 00:00. */
export function hm(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Hora no válida: ${time}`);
  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

/** The same ranges on several weekdays: weekly([TUE, WED], ["10:00", "14:00"], ["16:00", "20:00"]). */
export function weekly(weekdays: readonly number[], ...ranges: readonly [string, string][]): WeeklyRange[] {
  return weekdays.flatMap((weekday) => ranges.map(([start, end]) => ({ weekday, startMin: hm(start), endMin: hm(end) })));
}

type ServiceDefaults = Pick<PresetService, "minAdvanceMin" | "maxAdvanceDays">;
type ServiceInput = Omit<
  PresetService,
  "bufferBeforeMin" | "bufferAfterMin" | "minPeople" | "maxPeople" | "requiresManualConfirmation" | keyof ServiceDefaults
> &
  Partial<PresetService>;

/** Service builder with the sector's booking notice; one person, no margins and no manual confirmation by default. */
export function serviceBuilder(defaults: ServiceDefaults): (input: ServiceInput) => PresetService {
  return (input) => ({
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    minPeople: 1,
    maxPeople: 1,
    requiresManualConfirmation: false,
    ...defaults,
    ...input,
  });
}

/** Resource with capacity 1 unless given. */
export function resource(input: Omit<PresetResource, "capacity"> & { capacity?: number }): PresetResource {
  return { capacity: 1, ...input };
}
