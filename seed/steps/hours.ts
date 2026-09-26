// Opening hours of the sector and two closures relative to today, so the agenda always shows them ([ARR-07]).
import { businessHours, closures } from "@/db/schema";
import { localDateString } from "../dates";
import type { SeedStep } from "../types";

/** Closures as [days from today, days it lasts, reason]. */
const DEMO_CLOSURES: readonly [number, number, string][] = [
  [9, 1, "Festivo local"],
  [40, 2, "Cierre por formación del equipo"],
];

export const hoursStep: SeedStep = {
  name: "horario",
  prepare: async (ctx) => async (tx) => {
    await tx.insert(businessHours).values(ctx.preset.businessHours.map((range) => ({ ...range })));
    await tx.insert(closures).values(
      DEMO_CLOSURES.map(([offsetDays, days, reason]) => ({
        startDate: localDateString(ctx.now, ctx.timeZone, offsetDays),
        endDate: localDateString(ctx.now, ctx.timeZone, offsetDays + days - 1),
        reason,
      })),
    );
  },
};
