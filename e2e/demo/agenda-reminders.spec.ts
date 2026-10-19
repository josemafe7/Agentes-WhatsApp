// Booking reminders ([AGD-24], [AGD-25]): the demo comes with its own (the day before at 10:00 and 2 hours before, by
// WhatsApp, [ARR-25]); the owner leaves a single one, by email a week before, and the background job sends the reminder of
// a booking through the system mail, which the demo keeps in data/outbox, and sends it only once, even when the job runs
// again. The booking is the run's fixture (e2e/support/agenda-fixtures.ts): made ten days ago for the next day the salon
// opens, so its reminder is due at once with «1 semana antes» (a booking made during the test would only be reminded
// after a real wait). Being the only reminder, no later one is due yet, so the late one still goes ([AGD-25]).
// The demo's reminders are put back at the end, so the rest of the run keeps them.
// [HER-15] With them on by WhatsApp, a customer who books with the AI through the demo WhatsApp (the simulator, so nothing
// reaches Meta) is asked in the confirmation whether they want reminders, and a clear «Sí» is recorded as their permission.
import { agendaTestDate, DEMO_REMINDERS, emailsTo, offeredSlots, PICK_FIRST, saveReminderForm, switchReminders, WEEKDAYS, type ReminderForm } from "../support/agenda";
import { REMINDER_FIXTURE } from "../support/agenda-fixtures";
import { authStatePath } from "../support/app";
import { holdsFor, runQueue, untilWithQueue } from "../support/engine";
import { conversationLog } from "../support/inbox";
import { uniqueMessage, uniqueName, uniquePhone, uniqueRef } from "../support/names";
import { DEMO_WHATSAPP, simulatedConversationPath, simulateNextMessage, simulateTextMessage } from "../support/simulator";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

test("[AGD-24][AGD-25] with a single reminder by email, the job sends a booking's reminder once, even when it runs again", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const since = Date.now();
  const ref = uniqueRef(testInfo, "recordatorio");
  const reminders: ReminderForm = { enabled: true, rules: [{ lead: { hours: "1 semana antes" }, routes: ["Correo"], subject: `Recordatorio ${ref}: {servicio} a las {hora}` }] };
  // Only this test's: the demo's own reminders may also write to the fixture's customer.
  const sent = () => emailsTo(REMINDER_FIXTURE.email, since).filter((email) => email.subject.includes(`Recordatorio ${ref}:`));

  try {
    await test.step("[AGD-24] the owner leaves a single reminder: by email, a week before", async () => {
      // Saved off first and then switched on, so the job starts again now with these settings.
      await saveReminderForm(page, { ...reminders, enabled: false });
      await switchReminders(page, true);
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

    await test.step("[AGD-25] once: the job runs again (reminders switched off and on) and nothing more is sent", async () => {
      await switchReminders(page, false);
      await switchReminders(page, true);
      await holdsFor(request, async () => sent().length, 1, "the booking gets a single reminder", 8_000);
    });
  } finally {
    await saveReminderForm(page, DEMO_REMINDERS);
  }
});

test("[HER-15] booking with the AI by WhatsApp never asks about reminders: «Sí, por defecto» in the card, and «no quiero avisos» is recorded", async ({ page, request, openRouterKey }, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const day = agendaTestDate(testInfo, 1, WEEKDAYS.WED);
  const customer = uniqueName(testInfo, "Cliente avisos");
  await simulateTextMessage(page, {
    channel: DEMO_WHATSAPP,
    contactName: customer,
    phone: uniquePhone(testInfo),
    text: uniqueMessage(testInfo, `Hola, quiero reservar Corte de hombre con Andrés el ${day}, a nombre de ${customer}.`),
  });
  const inbox = await page.context().newPage();
  await inbox.goto(await simulatedConversationPath(page));
  const log = conversationLog(inbox);
  const replyWith = (text: string) => log.getByText(text, { exact: false });

  await untilWithQueue(request, async () => (await replyWith("tengo estos huecos").count()) > 0, "the agent offers free slots");
  expect(offeredSlots(await replyWith("tengo estos huecos").first().innerText()).length).toBeGreaterThan(0);

  await simulateNextMessage(page, PICK_FIRST);
  await untilWithQueue(request, async () => (await replyWith("Tu cita de Corte de hombre").count()) > 0, "the agent confirms the booking");
  // «Avisos de sus citas» se da por hecho (decision 0030): no question about it.
  await expect(replyWith("antes de tus citas?")).toHaveCount(0);

  // The contact's card: a column when there is room, a side panel opened from the header when there is not.
  const remindersLine = async () => {
    await inbox.reload();
    const column = inbox.getByRole("complementary", { name: "Ficha del contacto" });
    if (!(await column.isVisible())) await inbox.getByRole("button", { name: "Ficha del contacto" }).click();
    const card = column.or(inbox.getByRole("dialog", { name: "Ficha del contacto" }));
    return card.getByRole("listitem").filter({ hasText: "Avisos de sus citas" });
  };
  await expect(await remindersLine()).toContainText("Sí, por defecto");
  // Reloading closes the side panel: while it is open, the conversation behind it is hidden from the locators.
  await inbox.reload();

  await simulateNextMessage(page, "No quiero avisos de mis citas");
  await untilWithQueue(request, async () => (await replyWith("ya no te enviaremos avisos de tus citas").count()) > 0, "the agent confirms it");
  const after = await remindersLine();
  await expect(after).toContainText("No");
  await expect(after).not.toContainText("Sí");
  await inbox.close();
});
