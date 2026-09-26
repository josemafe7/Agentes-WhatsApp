import { getHoursStepData, MAX_RANGES_PER_DAY, SETUP_STEP } from "@/data/setup";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/format";
import { HoursForm } from "../_components/hours-form";
import { setupStepHref } from "../_lib/view";
import { stepActor, type SetupStepProps } from "./types";

/** Spain first (peninsula and Canary Islands), then nearby and Spanish-speaking zones. */
const FREQUENT_TIME_ZONES = [
  DEFAULT_TIMEZONE,
  "Atlantic/Canary",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/New_York",
];

function timeZoneOptions(current: string): { frequent: string[]; others: string[] } {
  const frequent = FREQUENT_TIME_ZONES.filter(isValidTimeZone);
  const all = Intl.supportedValuesOf("timeZone");
  const others = [...new Set([...all, current])].filter((zone) => isValidTimeZone(zone) && !frequent.includes(zone)).sort();
  return { frequent, others };
}

/** Step 3 ([ASI-06]): time zone, weekly ranges and closures. */
export async function HoursStep({ actor }: SetupStepProps) {
  const data = await getHoursStepData(stepActor(actor));
  return (
    <HoursForm
      initial={data}
      timeZones={timeZoneOptions(data.timezone)}
      maxRangesPerDay={MAX_RANGES_PER_DAY}
      backHref={setupStepHref(SETUP_STEP.business)}
    />
  );
}
