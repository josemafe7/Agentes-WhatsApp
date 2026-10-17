// The rules of the envíos that need no database ([ENV-03], [ENV-05]–[ENV-08], [AJU-18]): the hours they may go out,
// how often a contact may get one, the channels in their fixed order, the reasons a contact does not get one and the
// pace of each channel. Pure functions, in the business's time zone.
import "server-only";
import type { CampaignRuleKind } from "@/lib/enums";
import { addDays, daysBetween, instantToLocal, localToInstant, weekdayOf, type LocalDate } from "@/server/booking/time";

/** Why a contact does not get it ([ENV-05], [ENV-07]), as the screens say it. */
export const NOT_SENT_REASONS = {
  no_route: "Sin vía en ninguno de los canales marcados",
  no_permission: "Sin el permiso «Novedades y publicidad»",
  opted_out: "Se ha dado de baja",
  recent: "Recibió otro envío hace poco",
  channel_disconnected: "El canal no está conectado",
  bot_blocked: "Ha bloqueado el bot",
  phone_of_another: "Otro contacto tiene un WhatsApp con ese teléfono",
  demo_contact: "Es un contacto de la demo o del simulador",
  later_booking: "Ya tiene otra cita",
} as const;
export type NotSentReason = keyof typeof NOT_SENT_REASONS;

/** Pace per channel ([ENV-08]): WhatsApp per number and Telegram per bot, per minute. */
export const WHATSAPP_PER_MINUTE = 30;
export const TELEGRAM_PER_MINUTE = 20;

export type SendHours = { start: string; end: string };

export function minutesOfTime(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Whether `now` is inside the hours envíos may go out ([AJU-18]); `end` is not included. */
export function insideSendHours(now: Date, timeZone: string, hours: SendHours): boolean {
  const { minutes } = instantToLocal(now, timeZone);
  return minutes >= minutesOfTime(hours.start) && minutes < minutesOfTime(hours.end);
}

/** The next moment envíos may go out: now if inside the hours, else the next opening. */
export function nextSendMoment(now: Date, timeZone: string, hours: SendHours): Date {
  if (insideSendHours(now, timeZone, hours)) return now;
  const { date, minutes } = instantToLocal(now, timeZone);
  const day = minutes < minutesOfTime(hours.start) ? date : addDays(date, 1);
  return localToInstant(day, minutesOfTime(hours.start), timeZone);
}

/**
 * [ENV-06] A contact gets at most one envío every `days` days, counted by days in the business's time zone: not if they
 * got one that same day or in the `days - 1` days before.
 */
export function receivedRecently(lastReceived: readonly LocalDate[], today: LocalDate, days: number): boolean {
  return lastReceived.some((date) => {
    const ago = daysBetween(date, today);
    return ago >= 0 && ago < days;
  });
}

/** The local date of an instant, for the frequency rule. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  return instantToLocal(instant, timeZone).date;
}

/** The pace of one channel for the estimate: per hour, per day and what is left of today. */
export type ChannelPace = { count: number; perHour: number; perDay: number; leftToday: number };

/**
 * [ENV-07] When the envío would end, roughly: hour by hour inside the send hours from `start`, each channel sends what its
 * pace per hour and its cap per day let (the first day, what is left of it). Null when nothing has to go.
 */
export function estimatedEnd(start: Date, paces: readonly ChannelPace[], timeZone: string, hours: SendHours): Date | null {
  const left = paces.map((pace) => ({ ...pace, waiting: pace.count, today: pace.leftToday }));
  if (left.every((pace) => pace.waiting <= 0) || left.some((pace) => pace.waiting > 0 && (pace.perHour <= 0 || pace.perDay <= 0))) return null;
  const hourMs = 60 * 60_000;
  let moment = nextSendMoment(start, timeZone, hours);
  let day = localDateOf(moment, timeZone);
  // Hour by hour, jumping over the closed hours; a year at most.
  for (let step = 0; step < 24 * 366; step += 1) {
    const today = localDateOf(moment, timeZone);
    if (today !== day) {
      day = today;
      for (const pace of left) pace.today = pace.perDay;
    }
    let lastFraction = 0;
    for (const pace of left) {
      if (pace.waiting <= 0) continue;
      const sent = Math.max(0, Math.min(pace.waiting, pace.perHour, pace.today));
      pace.waiting -= sent;
      pace.today -= sent;
      if (pace.waiting <= 0) lastFraction = Math.max(lastFraction, sent / pace.perHour);
    }
    if (left.every((pace) => pace.waiting <= 0)) return new Date(moment.getTime() + Math.ceil(lastFraction * hourMs));
    moment = nextSendMoment(new Date(moment.getTime() + hourMs), timeZone, hours);
  }
  return moment;
}

/**
 * Meta codes of one recipient ([ENV-09]): no WhatsApp, the per-person marketing limit, marketing stopped, window, the
 * business blocked them, a Meta experiment that left them out, or the account may not write to their country (130497).
 */
export const RECIPIENT_CODES: ReadonlySet<number> = new Set([131026, 131049, 131050, 131047, 130403, 130472, 130497]);

/**
 * Meta codes that stop the envío at once ([ENV-09]), as docs/integracion-whatsapp.md lists them: its template paused,
 * disabled or not approved (132001, 132015, 132016); the account or the number restricted (368, 131031, and 131064, its
 * limit for misclassifying templates); messages dropped for quality or as spam (131048); publicidad switched off for the
 * Cloud API (131063).
 */
const TEMPLATE_CODES = new Set([132001, 132015, 132016]);
const RESTRICTED_CODES = new Set([368, 131031, 131064, 131063]);
const QUALITY_CODES = new Set([131048]);
export const STOP_CODES: ReadonlySet<number> = new Set([...TEMPLATE_CODES, ...RESTRICTED_CODES, ...QUALITY_CODES]);

/** Why the envío stopped, for its pause and the notice to the managers. */
export function stopReasonOf(code: number, message: string): string {
  if (TEMPLATE_CODES.has(code)) return `Meta ha pausado, desactivado o rechazado su plantilla de WhatsApp: ${message}`;
  if (RESTRICTED_CODES.has(code)) return `Meta ha restringido el número o la cuenta de WhatsApp: ${message}`;
  return `Meta descarta mensajes de este número por su calidad o por sospecha de spam: ${message}`;
}

/** When an automatic or repeated envío goes ([ENV-15], [ENV-16]): its time and, for the repeated ones, its day. */
export type RuleTiming = { kind: CampaignRuleKind; sendTime: string; weekday: number | null; monthDay: number | null };

function daysInMonth(date: LocalDate): number {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether it goes that day: every day after a booking; the day of the week; the day of the month, or its last day. */
function runsOn(timing: RuleTiming, date: LocalDate): boolean {
  if (timing.kind === "after_booking") return true;
  if (timing.kind === "weekly") return weekdayOf(date) === timing.weekday;
  return Number(date.slice(8, 10)) === Math.min(timing.monthDay ?? 1, daysInMonth(date));
}

/**
 * [ENV-15] [ENV-16] The first time it goes strictly after `after`, at its hour on the business's clock (also across a
 * change of time: an hour the clock skips moves forward, one it repeats is the first).
 */
export function nextRuleRun(timing: RuleTiming, after: Date, timeZone: string): Date {
  const minutes = minutesOfTime(timing.sendTime);
  let date = localDateOf(after, timeZone);
  for (let step = 0; step < 400; step += 1, date = addDays(date, 1)) {
    if (!runsOn(timing, date)) continue;
    const moment = localToInstant(date, minutes, timeZone);
    if (moment.getTime() > after.getTime()) return moment;
  }
  throw new Error("No se ha encontrado la próxima vez del envío.");
}

/**
 * [ENV-16] A time that the app did not reach on its own day (it was stopped) is not recovered: only the next goes.
 */
export function missedRun(run: Date, now: Date, timeZone: string): boolean {
  return localDateOf(now, timeZone) > localDateOf(run, timeZone);
}
