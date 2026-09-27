// Adds the agenda fixtures of the e2e run (e2e/support/agenda-fixtures.ts) to the freshly seeded demo database. Run by
// prepare-databases.mjs right after create-e2e-users.ts, with `tsx --conditions=react-server`, like the other scripts
// that load server code. It books through the booking service, as the app does, only with a clock ten days back.
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { contacts, services } from "@/db/schema";
import { addDays, createBooking, instantToLocal, loadAgendaSettings, localToInstant, SlotUnavailableError } from "@/server/booking";
import { REMINDER_FIXTURE } from "./agenda-fixtures";
import { DEMO_DATABASE_URL } from "./env";

const DAY_MS = 86_400_000;
/** 10:00, the salon's opening: the first time tried on the booking's day. */
const FIRST_TRY_MINUTES = 10 * 60;

async function main(): Promise<void> {
  // Never anywhere else: the test database of the run only.
  if (process.env.DATABASE_URL !== DEMO_DATABASE_URL) {
    throw new Error(`Solo se crean en la base de las pruebas (${DEMO_DATABASE_URL}).`);
  }
  const now = new Date();
  const bookedAt = new Date(now.getTime() - REMINDER_FIXTURE.bookedDaysAgo * DAY_MS);
  const { timezone } = await loadAgendaSettings();
  const [service] = await db.select({ id: services.id }).from(services).where(eq(services.name, REMINDER_FIXTURE.serviceName));
  if (!service) throw new Error(`La demo no tiene el servicio «${REMINDER_FIXTURE.serviceName}».`);
  const [contact] = await db
    .insert(contacts)
    .values({ name: REMINDER_FIXTURE.contactName, email: REMINDER_FIXTURE.email, createdAt: bookedAt, updatedAt: bookedAt })
    .returning({ id: contacts.id });

  const day = addDays(instantToLocal(now, timezone).date, REMINDER_FIXTURE.daysAhead);
  let start = localToInstant(day, FIRST_TRY_MINUTES, timezone);
  // A closed day or a taken time: the service offers the closest free slots from that day on.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await createBooking({ serviceId: service.id, resourceId: "any", start, contactId: contact.id, source: "human", actor: { type: "system" }, now: bookedAt });
      return;
    } catch (error) {
      const alternative = error instanceof SlotUnavailableError ? error.alternatives[0] : undefined;
      if (!alternative) throw error;
      start = alternative.start;
    }
  }
  throw new Error("No se ha encontrado un hueco para la cita del recordatorio.");
}

main()
  .catch((error: unknown) => {
    console.error("No se pudieron crear los datos de agenda de las pruebas:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
