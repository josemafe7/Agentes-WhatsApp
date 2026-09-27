// Background work of the agenda (decision 0008): the recurring round of booking reminders ([AGD-24], [MOT-15]).
// src/server/jobs/handlers/index.ts imports this file so every process that runs jobs knows it.
import "server-only";
import { registerJobHandler } from "@/server/jobs/registry";
import { BOOKING_REMINDERS_JOB, runBookingReminders } from "./reminders";

registerJobHandler(BOOKING_REMINDERS_JOB, async () => {
  await runBookingReminders();
});
