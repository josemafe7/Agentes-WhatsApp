// Prepared, not offered ([AGD-07], spec «Qué queda fuera»): services that need two resources at the same time (a
// professional and a room). Nothing reads or writes these tables yet; the availability engine already refuses such a
// service (`needsSecondResource`, reason "second_resource", src/server/booking/availability.ts).
// NOT exported from ./index.ts on purpose: a table in the schema without its migration breaks every query that walks
// all tables (src/server/demo/clear-data.ts). The phase integrator activates it in one step: add
// `export * from "./agenda-prepared";` to ./index.ts and run `pnpm db:generate` (additive migration).
// When implemented: a service is bookable only if one resource of service_resources AND one of
// service_secondary_resources are free for the whole occupied range; the second one is held in booking_secondary_resources
// with the same range, and the Postgres exclusion constraint of docs/modelo-de-datos.md applies to both.
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bookings, resources, services } from "./agenda";
import { id, timestamp, timestamps } from "./columns";

/** The second kind of resource a service also needs (any one of these, at the same time as the first). */
export const serviceSecondaryResources = sqliteTable(
  "service_secondary_resources",
  {
    id: id(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("service_secondary_resources_service_resource_uq").on(t.serviceId, t.resourceId),
    index("service_secondary_resources_resource_idx").on(t.resourceId),
  ],
);

/** The second resource a booking holds, over the same occupied range (start − margin … end + margin). */
export const bookingSecondaryResources = sqliteTable(
  "booking_secondary_resources",
  {
    id: id(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id),
    blockedStartAt: timestamp("blocked_start_at").notNull(),
    blockedEndAt: timestamp("blocked_end_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("booking_secondary_resources_booking_resource_uq").on(t.bookingId, t.resourceId),
    index("booking_secondary_resources_resource_blocked_idx").on(t.resourceId, t.blockedStartAt),
  ],
);
