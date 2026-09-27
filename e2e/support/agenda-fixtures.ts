// Data the agenda specs share with e2e/support/create-agenda-fixtures.ts, which writes it into the demo database of the
// run right after the seed (e2e/support/prepare-databases.mjs). No imports: the fixture script runs with tsx, outside
// Playwright.

/**
 * A customer who booked ten days ago a «Corte de hombre» for tomorrow, or the next day the salon opens ([AGD-24],
 * [AGD-25]). A reminder only goes to a booking made before its reminder moment, so one booked during a test would need a
 * real wait; this one is due as soon as reminders are switched on «1 semana antes». It is one of the first bookings of the
 * coming days, so it is in the first round of the reminders job (a round sends at most 50, the soonest first).
 */
export const REMINDER_FIXTURE = {
  contactName: "Cliente recordatorio e2e",
  email: "recordatorio-cita@e2e.test",
  serviceName: "Corte de hombre",
  /** Days from the day the demo is loaded to the booking: the free slot closest to its opening that day or after. */
  daysAhead: 1,
  /** How long ago it was booked. */
  bookedDaysAgo: 10,
} as const;
