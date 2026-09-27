// What a resource's page loads on the server ([AGD-02]): the resource (or «not found») and its upcoming absences.
// Each call checks the permission again in src/data ([SEG-04]).
import "server-only";
import { notFound } from "next/navigation";
import { getResource, type ResourceItem } from "@/data/agenda-config";
import { listTimeOff, type TimeOffItem } from "@/data/bookings-time-off";
import type { Actor } from "@/lib/permissions";
import { addDays, MAX_RANGE_DAYS } from "@/server/booking";
import { NotFoundError } from "@/server/errors";

/** Absences are listed for about a year ahead, in the longest ranges the data layer accepts. */
const CHUNKS = 6;

/** The resource, or the «not found» page for an unknown or malformed id. */
export async function loadResource(actor: Actor, id: string): Promise<ResourceItem> {
  try {
    return await getResource(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Absences of the resource that have not ended, from today (business-local "YYYY-MM-DD") for about a year. */
export async function upcomingAbsences(actor: Actor, resourceId: string, today: string, now = new Date()): Promise<TimeOffItem[]> {
  const ranges = Array.from({ length: CHUNKS }, (_, index) => {
    const from = addDays(today, index * MAX_RANGE_DAYS);
    return { from, to: addDays(from, MAX_RANGE_DAYS - 1) };
  });
  const lists = await Promise.all(ranges.map((range) => listTimeOff(actor, { ...range, resourceIds: [resourceId] })));
  const byId = new Map<string, TimeOffItem>();
  for (const item of lists.flat()) {
    if (item.kind === "absence" && item.endsAt > now) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
