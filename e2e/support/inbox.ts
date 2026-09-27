// The Bandeja ([BAN-*], [TRA-*]) and the notification bell ([PWA-06]) as the team uses them. Locators follow
// docs/pantallas.md «Bandeja» / «Navegación» and DESIGN.md «Bandeja y conversación», so a change of wording is fixed
// here and not in every spec (the list and the message parts follow src/app/(app)/bandeja):
//   /bandeja        quick tabs (links «Todas», «Pendientes de humano», «Mías»); the search box «Buscar conversaciones»
//                   (contact and text); the list «Conversaciones», each one a link to /bandeja/[id].
//   /bandeja/[id]   header with the state («Pendiente de humano»), the IA switch and «IA en pausa hasta …»; the hand-off
//                   reason and summary ([TRA-07]); the log «Mensajes de la conversación» with each author («IA · {agente}»,
//                   the person's name) and delivery state («Enviado», «Entregado», «Leído»); the composer — «Respuesta al
//                   cliente» and «Enviar» — that Solo lectura does not have. A conversation the role may not see: «Sin
//                   permiso».
//   top bar         the bell, a button «Notificaciones» (its name may add the unread count) that opens a popover with one
//                   link per notice to its screen: «Traspaso: …» → /bandeja/[id].
import { expect, type Locator, type Page } from "@playwright/test";
import { clickAndWaitForPost, escapeRegExp } from "./ui";

export const INBOX_PATH = "/bandeja";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const CONVERSATION_URL = new RegExp(`/bandeja/(${UUID})(?:[/?#]|$)`);

export function conversationPath(conversationId: string): string {
  return `${INBOX_PATH}/${conversationId}`;
}

export function conversationIdFromUrl(url: string): string {
  const id = CONVERSATION_URL.exec(url)?.[1];
  if (!id) throw new Error(`Not a conversation address: ${url}`);
  return id;
}

// ─── List ([BAN-01]–[BAN-03]) ────────────────────────────────────────────────────────────────────────────

/** The search box of the list. */
export function inboxSearch(page: Page): Locator {
  const main = page.getByRole("main");
  return main.getByRole("searchbox").or(main.getByRole("textbox", { name: /^Buscar/i })).first();
}

/** The conversations the list («Conversaciones») shows, each a link to /bandeja/[id]. */
export function conversationLinks(page: Page): Locator {
  return page.getByRole("list", { name: "Conversaciones" }).locator('a[href^="/bandeja/"]').filter({ visible: true });
}

async function isSelected(target: Locator): Promise<boolean> {
  const [selected, current, state] = await Promise.all([
    target.getAttribute("aria-selected"),
    target.getAttribute("aria-current"),
    target.getAttribute("data-state"),
  ]);
  return selected === "true" || (current !== null && current !== "false") || state === "active";
}

/** Opens the list on «Todas» (whatever the role's default tab is). */
export async function openInbox(page: Page): Promise<void> {
  await page.goto(INBOX_PATH);
  const all = page.getByRole("main").getByRole("tab", { name: "Todas", exact: true }).or(page.getByRole("main").getByRole("link", { name: "Todas", exact: true })).first();
  if ((await all.isVisible()) && !(await isSelected(all))) {
    await all.click();
    await expect.poll(() => isSelected(all), { message: "«Todas» is the tab shown" }).toBe(true);
  }
}

/** Searches the list for `text` and returns the conversations it shows. */
export async function searchInbox(page: Page, text: string): Promise<Locator> {
  await openInbox(page);
  const box = inboxSearch(page);
  await box.fill(text);
  await box.press("Enter");
  return conversationLinks(page);
}

/** The messages of the open conversation (role log, «Mensajes de la conversación»). */
export function conversationLog(page: Page): Locator {
  return page.getByRole("log", { name: /^Mensajes/ });
}

/** A message of the customer in the open conversation, by its exact text. */
export function customerMessage(page: Page, text: string): Locator {
  return conversationLog(page).getByText(text, { exact: true }).first();
}

/**
 * Finds the one conversation with `text` (a unique customer message) through the search, opens it and returns its id.
 */
export async function openConversationWith(page: Page, text: string): Promise<string> {
  const links = await searchInbox(page, text);
  await expect(links, `one conversation has «${text}»`).toHaveCount(1);
  await links.click();
  await expect(page).toHaveURL(CONVERSATION_URL);
  await expect(customerMessage(page, text)).toBeVisible();
  return conversationIdFromUrl(page.url());
}

// ─── Conversation ([BAN-04]–[BAN-13], [TRA-02], [TRA-07]) ────────────────────────────────────────────────

/**
 * «IA · {agente}» over each reply of that agent (DESIGN.md «Autores de los mensajes»); the mark may go on with the
 * channel for screen readers («… por Chat web · …»).
 */
export function aiAuthor(page: Page, agentName: string): Locator {
  return conversationLog(page).getByText(new RegExp(`^IA · ${escapeRegExp(agentName)}(?![\\p{L}\\p{N}])`, "u"));
}

/** Any «IA · …» author mark. */
export function anyAiAuthor(page: Page): Locator {
  return conversationLog(page).getByText(/^IA · \S/);
}

/** «Pendiente de humano» ([BAN-12], [TRA-02]). */
export function pendingHumanState(page: Page): Locator {
  return page.getByRole("main").getByText("Pendiente de humano", { exact: true }).first();
}

/** «IA en pausa hasta …» ([BAN-10], [BAN-11]). */
export function aiPausedNotice(page: Page): Locator {
  return page.getByRole("main").getByText(/IA en pausa hasta/).first();
}

/** The composer's text box. */
export function replyBox(page: Page): Locator {
  return page.getByRole("main").getByRole("textbox", { name: /^(Escribe|Mensaje|Responde|Respuesta|Tu respuesta)/i });
}

/** «Enviar» of the composer. */
export function sendReplyButton(page: Page): Locator {
  return page.getByRole("main").getByRole("button", { name: /^Enviar$/ });
}

/** A person of the team writes to the customer from the open conversation ([BAN-11]). */
export async function replyAsPerson(page: Page, text: string): Promise<void> {
  await replyBox(page).fill(text);
  await clickAndWaitForPost(page, sendReplyButton(page));
  await expect(conversationLog(page).getByText(text, { exact: true }).first()).toBeVisible();
}

// ─── Notification bell ([PWA-06], [TRA-05]) ──────────────────────────────────────────────────────────────

export function notificationsButton(page: Page): Locator {
  return page.getByRole("button", { name: /^(Notificaciones|Avisos)/ }).first();
}

/** Opens the bell's popover and returns it once loaded. */
export async function openNotifications(page: Page): Promise<Locator> {
  await notificationsButton(page).click();
  const popover = page
    .locator('[data-slot="popover-content"]')
    .or(page.getByRole("dialog", { name: /Notificaciones|Avisos/ }))
    .first();
  await expect(popover).toBeVisible();
  await expect(popover.locator('[data-slot="skeleton"]')).toHaveCount(0);
  return popover;
}

/** The hand-off notice of one conversation in an open bell. */
export function handoffNotice(popover: Locator, conversationId: string): Locator {
  return popover.locator(`a[href="${conversationPath(conversationId)}"]`).filter({ hasText: /Traspaso/ });
}

/**
 * The person signed in on `page` has the hand-off notice of the conversation in the bell (reloading while it arrives).
 * Returns the notice, with the bell left open.
 */
export async function expectHandoffNotice(page: Page, conversationId: string): Promise<Locator> {
  await page.goto(INBOX_PATH);
  const found: { notice: Locator | null } = { notice: null };
  await expect(async () => {
    await page.reload();
    const notice = handoffNotice(await openNotifications(page), conversationId);
    await expect(notice).toBeVisible({ timeout: 2_000 });
    found.notice = notice;
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });
  if (!found.notice) throw new Error(`No hand-off notice for ${conversationId}`);
  return found.notice;
}

/** The person signed in on `page` has no hand-off notice of the conversation. */
export async function expectNoHandoffNotice(page: Page, conversationId: string): Promise<void> {
  await page.goto(INBOX_PATH);
  const popover = await openNotifications(page);
  await expect(handoffNotice(popover, conversationId)).toHaveCount(0);
  await page.keyboard.press("Escape");
}

/** Text of the delivery state of an outgoing message (DESIGN.md «Estados de entrega»). */
export const DELIVERY_STATE = /Enviado|Entregado|Leído/;

/** A regular expression that matches any of `texts` literally. */
export function anyOf(...texts: string[]): RegExp {
  return new RegExp(texts.map(escapeRegExp).join("|"));
}
