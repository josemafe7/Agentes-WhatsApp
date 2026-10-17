// Background work of the agenda (decision 0008): the recurring round of booking reminders ([AGD-24], [MOT-15]), the
// «¡Gracias!» of a reminder's «Confirmo» ([AGD-32]) and the next channel of a reminder Meta could not deliver.
// src/server/jobs/handlers/index.ts imports this file so every process that runs jobs knows it.
import "server-only";
import { registerJobHandler } from "@/server/jobs/registry";
import { REMINDER_FALLBACK_JOB, REMINDER_THANKS_JOB, reminderFallbackPayload, reminderThanksPayload, runReminderFallback, sendReminderThanks } from "./reminder-buttons";
import { BOOKING_REMINDERS_JOB, runBookingReminders } from "./reminders";

registerJobHandler(BOOKING_REMINDERS_JOB, async () => {
  await runBookingReminders();
});

registerJobHandler(
  REMINDER_THANKS_JOB,
  async (payload) => {
    await sendReminderThanks(payload);
  },
  { payload: reminderThanksPayload },
);

registerJobHandler(
  REMINDER_FALLBACK_JOB,
  async (payload) => {
    await runReminderFallback(payload);
  },
  { payload: reminderFallbackPayload },
);
