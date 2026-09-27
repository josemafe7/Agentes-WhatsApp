// The agenda's server side ([AGD-*]): availability engine (pure), booking service (transactions, history, notices),
// reminders and the helpers for business-local time. Screens and actions go through src/data/bookings*.ts and
// src/data/agenda-config.ts, which check permissions; the agent's tools and the seed use this entry directly.
import "server-only";

export {
  ANY_RESOURCE,
  bookingTimes,
  closestSlots,
  computeAvailability,
  freeResourcesForStart,
  MAX_RANGE_DAYS,
  OCCUPYING_STATUSES,
  pickSuggestions,
  type AvailabilityBooking,
  type AvailabilityInput,
  type AvailabilityResource,
  type AvailabilityResult,
  type AvailabilityService,
  type AvailableSlot,
  type FreeResource,
  type UnavailableReason,
  type WeeklyRange,
} from "./availability";
export { BOOKING_STATUS_LABELS, bookingDayText, bookingTimeText, bookingWord } from "./format";
export { loadAgendaSettings, loadEngineData, loadService, loadServiceResourceIds, toEngineService, type AgendaSettingsSnapshot, type EngineData, type LoadedService, type ServiceRow } from "./load";
export { BOOKING_PENDING_EVENT, bookingNoticeText, notifyPendingBooking, sendBookingNotice, type BookingNoticeKind, type BookingNoticeResult } from "./notices";
export {
  defaultReminderEmail,
  isReminderFieldKey,
  REMINDER_FIELDS,
  renderReminderText,
  templateVariablesFor,
  type ReminderFieldKey,
  type ReminderValues,
} from "./reminder-fields";
export { BOOKING_REMINDERS_JOB, REMINDERS_INTERVAL_MS, runBookingReminders, syncBookingReminderJob, type ReminderRoundResult } from "./reminders";
export {
  addTimeOff,
  BookingRuleError,
  cancelBooking,
  cancelBookingReporting,
  changeBookingStatus,
  changeBookingStatusReporting,
  createBooking,
  deleteTestBookings,
  findAlternatives,
  recordBookingEvent,
  removeTimeOff,
  rescheduleBooking,
  rescheduleBookingReporting,
  SLOT_TAKEN_MESSAGE,
  SlotUnavailableError,
  UNAVAILABLE_REASON_TEXT,
  updateBookingDetails,
  type AddTimeOffInput,
  type BookingActor,
  type BookingChange,
  type BookingEventAction,
  type BookingScope,
  type ChangeBookingStatusInput,
  type CreateBookingInput,
  type RescheduleBookingInput,
  type UpdateBookingDetailsInput,
} from "./service";
export {
  addDays,
  daysBetween,
  formatLocalIso,
  formatLocalMinute,
  instantToLocal,
  isLocalDate,
  localDayBounds,
  localToInstant,
  parseLocalDateTime,
  type LocalDate,
} from "./time";
export { selectBookingView, selectBookingViews, type BookingView } from "./views";
