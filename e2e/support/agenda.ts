// The Agenda ([AGD-*]) and the agent's booking tools ([HER-*]) as the agenda specs use them, in one place. Locators follow
// docs/pantallas.md «Agenda», DESIGN.md «Agenda (calendario)» / «Estados de cita» and src/app/(app)/agenda, so a change of
// wording is fixed here and not in every spec:
//   /agenda?vista=dia|semana|mes|recursos&fecha=AAAA-MM-DD   the calendar, its period written out in a heading of the
//                    toolbar («Lunes, 28 de septiembre de 2026», «Semana del …», «Septiembre de 2026»); each booking is a link
//                    to its panel showing its time, customer and service («Prueba» on test bookings and, by capacity,
//                    «N pers.»), named for screen readers with all of it («… · Origen: IA por <canal> · Prueba»); by capacity
//                    the resources view marks the occupancy of each half hour («6/8»).
//   ?cita=<id>       the booking's panel (a dialog): status («Pendiente», «Confirmada»…), «Prueba», service, resource, when,
//                    customer (link to /contactos/<id>), conversation (link to /bandeja/<id>), origin («IA · <canal>»,
//                    «Persona» or «Web»), notes, author and history.
//   drag and drop    a block dragged with the mouse to another time asks the server to move it; if the place is not free
//                    the booking stays where it was and a toast says why («Ese hueco ya no está libre.»).
//   «Citas de prueba (N)»  in the page header while there are test bookings: a dialog with «Borrar todas», confirmed with
//                    «Borrar» ([PRU-04]).
//   /ajustes/recordatorios   «Enviar recordatorios» (switch), «Cuándo» (select: «1 semana antes»…), «Por dónde» (radio
//                    «WhatsApp» / «Email»), «Asunto», «Guardar recordatorios» → «Recordatorios guardados.».
// The agent's side: the simulated OpenRouter books like a customer would (e2e/mocks/routes/booking.mjs), so the specs read
// the offered slots from the reply («[AAAA-MM-DDTHH:mm]») and what the tools returned from the mock's records.
import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { chatRequests, messageText } from "./ai";
import {
  agentIdFromUrl,
  agentPath,
  createNamedAgent,
  expectSaved,
  NEW_AGENT_PATH,
  saveEditor,
  sendTestMessage,
  testChatLog,
  testMessageBox,
  unsavedChangesBar,
} from "./agents";
import { setUpWebchat, type WebchatSetup } from "./channels";
import { openNotifications } from "./inbox";
import type { MockClient } from "./mock-client";
import { uniqueName } from "./names";
import { OUTBOX_DIR, parseEml } from "./outbox";
import { clickAndWaitForPost, escapeRegExp } from "./ui";

export const AGENDA_PATH = "/agenda";
export const REMINDERS_PATH = "/ajustes/recordatorios";
/** The business time zone of the demos (the seed's default, [AGD-28]). */
export const BUSINESS_TIME_ZONE = "Europe/Madrid";

// ─── Dates ───────────────────────────────────────────────────────────────────────────────────────────────

export const WEEKDAYS = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 } as const;
export type Weekday = (typeof WEEKDAYS)[keyof typeof WEEKDAYS];

/** Today in the business time zone, «AAAA-MM-DD». */
export function localToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function utcOf(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(utcOf(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: string): Weekday {
  return (((utcOf(date).getUTCDay() + 6) % 7) + 1) as Weekday;
}

/**
 * First day of each week the agenda specs book in: far from the demo's own bookings, never on its closures (days 9 and
 * 40–41 from the day it is loaded, seed/steps/hours.ts) and within the 60 days its services can be booked ahead.
 */
const BOOKING_WEEKS = [21, 28, 44, 51] as const;
export type BookingWeek = 0 | 1 | 2 | 3;

/**
 * The day a spec books on: the `weekday` of its `week`, one week later on each retry, so a retry never finds the
 * bookings of the failed attempt. Each spec uses its own week and weekday.
 */
export function agendaTestDate(testInfo: TestInfo, week: BookingWeek, weekday: Weekday): string {
  const index = Math.min(week + testInfo.retry, BOOKING_WEEKS.length - 1);
  const first = addDays(localToday(), BOOKING_WEEKS[index]);
  return addDays(first, (weekday - weekdayOf(first) + 7) % 7);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «Lunes, 28 de septiembre de 2026»: the day and resource views. */
export function dayPeriodLabel(date: string): string {
  return capitalize(new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(utcOf(date)));
}

/** «Septiembre de 2026»: the month view. */
export function monthPeriodLabel(date: string): string {
  return capitalize(new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "long", year: "numeric" }).format(utcOf(date)));
}

/** «Semana del 21 al 27 de septiembre»: the week view. */
export const WEEK_PERIOD_LABEL = /^Semana del \d/;

/** The period the calendar shows, written out in its toolbar (a heading). */
export function periodHeading(page: Page, period: string | RegExp): Locator {
  return page.getByRole("main").getByRole("heading", { name: period });
}

// ─── The agent's booking tools ([HER-01], [AGE-08]) ─────────────────────────────────────────────────────────

/** Herramientas switches the simulated model needs to book (src/lib/agent-tools.ts SYSTEM_TOOL_LABELS). */
export const BOOKING_TOOL_LABELS = ["Ver los servicios", "Consultar huecos libres", "Crear citas"] as const;

/** Herramientas › the booking tools switched on and saved (checked again after a reload). */
export async function enableBookingTools(page: Page, agentId: string): Promise<void> {
  await page.goto(agentPath(agentId, "herramientas"));
  const main = page.getByRole("main");
  for (const label of BOOKING_TOOL_LABELS) {
    const toggle = main.getByRole("switch", { name: label, exact: true });
    await expect(toggle, `«${label}» can be switched on (fase 5)`).toBeEnabled();
    if (!(await toggle.isChecked())) await toggle.click();
  }
  if (await unsavedChangesBar(page).isVisible()) {
    await saveEditor(page);
    await expectSaved(page);
  }
  await page.reload();
  for (const label of BOOKING_TOOL_LABELS) await expect(main.getByRole("switch", { name: label, exact: true })).toBeChecked();
}

export type BookingAgent = { agentId: string; agentName: string };

/** «Nuevo agente» from «Plantilla de <sector>» (the business's own sector) with a name of its own; returns its id. */
async function createAgentOfSector(page: Page, sectorLabel: string, name: string): Promise<string> {
  await page.goto(NEW_AGENT_PATH);
  await page.getByRole("radio", { name: new RegExp(`Plantilla de ${escapeRegExp(sectorLabel)}`) }).check();
  await page.getByLabel("Nombre del agente", { exact: true }).fill(name);
  await clickAndWaitForPost(page, page.getByRole("button", { name: /^Crear( el)? agente$/ }));
  await expect(page).toHaveURL(/\/agentes\/[0-9a-f-]{36}(?:[/?#]|$)/);
  return agentIdFromUrl(page.url());
}

/**
 * An agent of the test's own with the booking tools on: from the hair salon template of the demo, or from the template
 * of `sectorLabel` (the restaurant server).
 */
export async function setUpBookingAgent(page: Page, testInfo: TestInfo, label: string, options: { sectorLabel?: string } = {}): Promise<BookingAgent> {
  const agentName = uniqueName(testInfo, label);
  const agentId = options.sectorLabel ? await createAgentOfSector(page, options.sectorLabel, agentName) : await createNamedAgent(page, agentName);
  await enableBookingTools(page, agentId);
  return { agentId, agentName };
}

/** Its own agent with the booking tools and a web chat where it answers. */
export async function setUpBookingWebchat(page: Page, testInfo: TestInfo, label: string): Promise<WebchatSetup> {
  const setup = await setUpWebchat(page, testInfo, label);
  await enableBookingTools(page, setup.agentId);
  return setup;
}

/** «Probar» of an agent, ready to write. */
export async function openAgentTest(page: Page, agentId: string): Promise<void> {
  await page.goto(agentPath(agentId, "probar"));
  await expect(testMessageBox(page)).toBeEditable();
}

/**
 * Sends a customer message in «Probar» and returns the agent's reply: the text of the conversation from its last «Soy
 * <agente>,» (every answer of the simulated model starts so).
 */
export async function testTurn(page: Page, agentName: string, text: string): Promise<string> {
  const log = testChatLog(page);
  const marker = `Soy ${agentName},`;
  const replies = async () => (await log.innerText()).split(marker).length - 1;
  const before = await replies();
  await sendTestMessage(page, text);
  await expect.poll(replies, { message: `${agentName} answers «${text}» in Probar` }).toBe(before + 1);
  const all = await log.innerText();
  return all.slice(all.lastIndexOf(marker));
}

/** What the customer writes to take the first slot offered. */
export const PICK_FIRST = "Me va bien la primera";

// ─── What the agent offered and what its tools did ─────────────────────────────────────────────────────────

const SLOT_MARK = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:[+-]\d{2}:\d{2})?)\]/g;

/** The «inicio» of each slot an offer of the simulated model shows, in order. */
export function offeredSlots(text: string): string[] {
  return [...text.matchAll(SLOT_MARK)].map((match) => match[1]);
}

/** «10:00» of «2026-10-21T10:00». */
export function timeOf(start: string): string {
  return start.slice(11, 16);
}

/** «2026-10-21» of «2026-10-21T10:00». */
export function dateOf(start: string): string {
  return start.slice(0, 10);
}

export type ToolUse = {
  name: string;
  args: Record<string, unknown>;
  /** What the tool answered (its JSON), or null while it has not answered or if it was cut short. */
  result: Record<string, unknown> | null;
  /** The conversation (`session_id`) of the request; «Probar» has none. */
  sessionId: string | null;
  /** The system prompt of the request («Te llamas <agente>.» tells the agent). */
  prompt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Every tool call the app made (as the simulated model asked for them), once each, with the tool's answer. */
export async function toolUses(mock: MockClient): Promise<ToolUse[]> {
  const uses = new Map<string, ToolUse>();
  for (const request of await chatRequests(mock)) {
    const prompt = messageText(request.body.messages[0]);
    const sessionId = request.body.session_id ?? null;
    for (const message of request.body.messages as unknown[]) {
      if (!isRecord(message)) continue;
      if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          if (!isRecord(call) || typeof call.id !== "string" || !isRecord(call.function) || uses.has(call.id)) continue;
          const args = parseRecord(String(call.function.arguments ?? "")) ?? {};
          uses.set(call.id, { name: String(call.function.name ?? ""), args, result: null, sessionId, prompt });
        }
      }
      if (message.role === "tool" && typeof message.tool_call_id === "string") {
        const use = uses.get(message.tool_call_id);
        if (use && use.result === null) use.result = parseRecord(typeof message.content === "string" ? message.content : "");
      }
    }
  }
  return [...uses.values()];
}

/** The tool calls of one agent (by its prompt), optionally of one tool. */
export async function toolUsesOf(mock: MockClient, agentName: string, tool?: string): Promise<ToolUse[]> {
  return (await toolUses(mock)).filter((use) => use.prompt.includes(`Te llamas ${agentName}.`) && (!tool || use.name === tool));
}

/** The conversation (`session_id`) of the first chat request that carried `customerText`. */
export async function conversationOfMessage(mock: MockClient, customerText: string): Promise<string> {
  for (const request of await chatRequests(mock)) {
    const carries = request.body.messages.some((message) => message.role === "user" && messageText(message).includes(customerText));
    if (carries && request.body.session_id) return request.body.session_id;
  }
  throw new Error(`No chat request carried «${customerText}»`);
}

/** The booking id crear_cita returned, when it booked. */
export function bookedId(use: ToolUse): string {
  const booking = use.result?.cita;
  if (use.result?.ok !== true || !isRecord(booking) || typeof booking.cita_id !== "string") {
    throw new Error(`crear_cita did not book: ${JSON.stringify(use.result)}`);
  }
  return booking.cita_id;
}

// ─── Calendar and booking panel ([AGD-16]–[AGD-19]) ─────────────────────────────────────────────────────────

export type AgendaView = "dia" | "semana" | "mes" | "recursos";

export function agendaPath(options: { view?: AgendaView; date?: string; bookingId?: string } = {}): string {
  const query = new URLSearchParams();
  if (options.view) query.set("vista", options.view);
  if (options.date) query.set("fecha", options.date);
  if (options.bookingId) query.set("cita", options.bookingId);
  const text = query.toString();
  return text ? `${AGENDA_PATH}?${text}` : AGENDA_PATH;
}

/** The blocks of the calendar that show `text` (a customer's name: the specs use unique ones). */
export function bookingBlocks(page: Page, text: string | RegExp): Locator {
  const main = page.getByRole("main");
  return main.getByRole("button").or(main.getByRole("link")).filter({ hasText: text });
}

/** The panel of the booking open with ?cita= ([AGD-19]). */
export function bookingPanel(page: Page): Locator {
  return page.getByRole("dialog").first();
}

/** Opens the calendar of `date` with the panel of `bookingId`. */
export async function openBookingPanel(page: Page, bookingId: string, date?: string): Promise<Locator> {
  await page.goto(agendaPath({ view: "dia", date, bookingId }));
  const panel = bookingPanel(page);
  await expect(panel, "the booking's panel opens").toBeVisible();
  return panel;
}

/** Link of the panel to the booking's conversation in the Bandeja. */
export function conversationLinkIn(panel: Locator): Locator {
  return panel.locator('a[href^="/bandeja/"]');
}

/** Link of the panel to the booking's contact. */
export function contactLinkIn(panel: Locator): Locator {
  return panel.locator('a[href^="/contactos/"]');
}

/**
 * Drags `block` vertically by `dy` pixels as a person does with the mouse: press, a small move to start the drag, the
 * rest in steps, release.
 */
export async function dragBlock(page: Page, block: Locator, dy: number): Promise<void> {
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  if (!box) throw new Error("The booking block is not on screen");
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 10);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + Math.sign(dy) * 8, { steps: 4 });
  await page.mouse.move(x, y + dy, { steps: 16 });
  await page.mouse.up();
}

/** Top edge of a block on screen. */
export async function topOf(block: Locator): Promise<number> {
  const box = await block.boundingBox();
  if (!box) throw new Error("The booking block is not on screen");
  return box.y;
}

// ─── Test bookings ([PRU-04]) ───────────────────────────────────────────────────────────────────────────────

/** The «Prueba» chip of a test booking (DESIGN.md «Estados de cita»). */
export const TEST_BOOKING_CHIP = "Prueba";

/** The agenda's «Citas de prueba (N)» (only while there are test bookings), with the business's word for bookings. */
export function testBookingsButton(page: Page): Locator {
  return page.getByRole("button", { name: /^(Citas|Reservas) de prueba \(\d+\)$/ });
}

/** Agente › Probar › «Borrar citas de prueba», confirmed: the same deletion from the page where they are made. */
export async function deleteTestBookingsFromProbar(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Borrar (citas|reservas) de prueba$/ }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await clickAndWaitForPost(page, confirm.getByRole("button", { name: "Borrar", exact: true }));
  await expect(confirm).toHaveCount(0);
}

/** Agenda › «Citas de prueba (N)» › «Borrar todas», confirmed: every test booking goes at once ([PRU-04]). */
export async function deleteTestBookings(page: Page): Promise<void> {
  await page.goto(AGENDA_PATH);
  await testBookingsButton(page).click();
  const dialog = page.getByRole("dialog", { name: /de prueba$/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Borrar todas" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await clickAndWaitForPost(page, confirm.getByRole("button", { name: "Borrar", exact: true }));
  await expect(confirm).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
}

// ─── Notices of the team ([AGD-22]) ─────────────────────────────────────────────────────────────────────────

/** The notice of a booking waiting for confirmation in an open bell: it links to the booking's panel. */
export function pendingBookingNotice(popover: Locator, bookingId: string): Locator {
  return popover.locator(`a[href="${agendaPath({ bookingId })}"]`);
}

/** The person signed in on `page` has the notice of the pending booking in the bell (reloading while it arrives). */
export async function expectPendingBookingNotice(page: Page, bookingId: string): Promise<Locator> {
  await page.goto(AGENDA_PATH);
  const found: { notice: Locator | null } = { notice: null };
  await expect(async () => {
    await page.reload();
    const notice = pendingBookingNotice(await openNotifications(page), bookingId);
    await expect(notice).toBeVisible({ timeout: 2_000 });
    found.notice = notice;
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });
  if (!found.notice) throw new Error(`No notice for the pending booking ${bookingId}`);
  return found.notice;
}

// ─── Reminders ([AGD-24], [AGD-25]) ─────────────────────────────────────────────────────────────────────────

export type ReminderForm = { enabled: boolean; lead: string; channel: "WhatsApp" | "Email"; subject: string };

function remindersSwitch(page: Page): Locator {
  return page.getByRole("main").getByRole("switch", { name: "Enviar recordatorios" });
}

function leadPicker(page: Page): Locator {
  return page.getByRole("main").getByRole("combobox", { name: "Cuándo" });
}

/** What Ajustes › Recordatorios shows now (to put it back after a test). */
export async function readReminderForm(page: Page): Promise<ReminderForm> {
  await page.goto(REMINDERS_PATH);
  const main = page.getByRole("main");
  const enabled = await remindersSwitch(page).isChecked();
  const lead = ((await leadPicker(page).textContent()) ?? "").trim();
  const channel = (await main.getByRole("radio", { name: "Email", exact: true }).isChecked()) ? "Email" : "WhatsApp";
  const subject = channel === "Email" ? await main.getByLabel(/^Asunto/).inputValue() : "";
  return { enabled, lead, channel, subject };
}

/** Fills Ajustes › Recordatorios and saves it («Recordatorios guardados.»). */
export async function saveReminderForm(page: Page, form: ReminderForm): Promise<void> {
  await page.goto(REMINDERS_PATH);
  const main = page.getByRole("main");
  const toggle = remindersSwitch(page);
  if ((await toggle.isChecked()) !== form.enabled) await toggle.click();
  const picker = leadPicker(page);
  if (((await picker.textContent()) ?? "").trim() !== form.lead) {
    await picker.click();
    await page.getByRole("option", { name: form.lead, exact: true }).click();
    await expect(picker).toHaveText(form.lead);
  }
  await main.getByRole("radio", { name: form.channel, exact: true }).check();
  if (form.channel === "Email") await main.getByLabel(/^Asunto/).fill(form.subject);
  await clickAndWaitForPost(page, main.getByRole("button", { name: "Guardar recordatorios" }));
  await expect(main.getByRole("status").filter({ hasText: "Recordatorios guardados." })).toBeVisible();
}

/** The .eml files of data/outbox to `to` written since `since` (the demo keeps unsent mail there, [AJU-06]). */
export function emailsTo(to: string, since: number): { file: string; subject: string; text: string }[] {
  if (!fs.existsSync(OUTBOX_DIR)) return [];
  const wanted = to.toLowerCase();
  return fs
    .readdirSync(OUTBOX_DIR)
    .filter((name) => name.endsWith(".eml"))
    .filter((name) => fs.statSync(path.join(OUTBOX_DIR, name)).mtimeMs >= since - 2_000)
    .map((name) => parseEml(name, fs.readFileSync(path.join(OUTBOX_DIR, name), "utf8")))
    .filter((email) => email.to.toLowerCase().includes(wanted))
    .map(({ file, subject, text }) => ({ file, subject, text }));
}
