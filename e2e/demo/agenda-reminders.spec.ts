// Booking reminders ([AGD-24], [AGD-25]): off by default; once the owner switches them on in Ajustes › Recordatorios (by
// email, a week before), the background job sends the reminder of a booking through the system mail, which the demo keeps
// in data/outbox, and sends it only once, even when the job runs again. The booking is the run's fixture
// (e2e/support/agenda-fixtures.ts): made ten days ago for the next day the salon opens, so its reminder is due at once
// with «1 semana antes» (a booking made during the test would only be reminded after a real wait).
// The settings are put back as they were at the end, so the rest of the run keeps the demo's reminders.
import { emailsTo, readReminderForm, saveReminderForm, type ReminderForm } from "../support/agenda";
import { REMINDER_FIXTURE } from "../support/agenda-fixtures";
import { authStatePath } from "../support/app";
import { holdsFor, runQueue } from "../support/engine";
import { uniqueRef } from "../support/names";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

test("[AGD-24][AGD-25] with reminders on by email, the job sends a booking's reminder once, even when it runs again", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const since = Date.now();
  const ref = uniqueRef(testInfo, "recordatorio");
  const reminders: ReminderForm = { enabled: true, lead: "1 semana antes", channel: "Email", subject: `Recordatorio ${ref}: {servicio} a las {hora}` };
  const before = await readReminderForm(page);
  const sent = () => emailsTo(REMINDER_FIXTURE.email, since);

  try {
    await test.step("[AGD-24] the owner switches reminders on: by email, a week before", async () => {
      // Off first when they were on, so the job starts again now with these settings.
      if (before.enabled) await saveReminderForm(page, { ...before, enabled: false });
      await saveReminderForm(page, reminders);
    });

    await test.step("[AGD-24] the job sends the reminder to the customer's email, with the booking's service", async () => {
      await expect
        .poll(
          async () => {
            await runQueue(request);
            return sent().length;
          },
          { message: `a reminder to ${REMINDER_FIXTURE.email} in data/outbox`, timeout: 30_000, intervals: [1_000, 2_000] },
        )
        .toBe(1);
      const [email] = sent();
      expect(email.subject).toContain(`Recordatorio ${ref}: ${REMINDER_FIXTURE.serviceName} a las `);
    });

    await test.step("[AGD-25] once: the job runs again (reminders saved again) and nothing more is sent", async () => {
      await saveReminderForm(page, { ...reminders, enabled: false });
      await saveReminderForm(page, reminders);
      await holdsFor(request, async () => sent().length, 1, "the booking gets a single reminder", 8_000);
    });
  } finally {
    await saveReminderForm(page, before);
  }
});
