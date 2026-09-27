// Email channels as the owner connects and uses them ([COR-*], [CAN-*], [BAN-09]). Locators follow docs/pantallas.md
// («Asistente de correo», «Panel del canal», «Conversación»), DESIGN.md and src/app/(app)/canales/nuevo/correo,
// src/app/(app)/canales/[id]/_email and src/app/(app)/bandeja/[id]/_email, so a change of wording is fixed here:
//   /canales/nuevo/correo   «Proveedor de correo» (combobox: «Gmail», «Outlook / Microsoft 365», «Otro (IMAP/SMTP)») and
//                           «Nombre». Gmail: «URI de redirección autorizada» to copy, «Client ID», «Client Secret» and
//                           «Conectar con Google». Outlook: «Client ID (Application ID)», «Client Secret», «Caducidad del
//                           Client Secret» (date), «Tenant ID» («common» by default) and «Conectar con Microsoft». The
//                           browser goes to the provider's consent screen and comes back to ?canal=<id>&conexion=ok:
//                           «Respuestas y agente» with «Buzón conectado: <dirección>» (region «Buzón conectado») and its
//                           «Permisos de la cuenta» (each «Concedido» or «Falta»), «Agente activo» and «IA del canal» (saved at once), «Modo de respuesta»
//                           («Borrador para revisar (recomendado)» / «Automático») and «Guardar y terminar» → /canales/<id>.
//                           A return that failed: «No se ha conectado el buzón» and the reason in Spanish.
//   /canales/<id>           the mailbox's panel: «Leer ahora» (a read as soon as the background work runs) and «Revalidar»;
//                           alerts «Buzón conectado» after the return and «Requiere reconexión» with the reason and
//                           «Reconectar» (dialog «Conectar con Google» → «Continuar con Google»); «Correos que la IA no
//                           contesta» with «Ignorados hasta ahora» (reason and count, [COR-16]); «Desactivar» at the bottom.
//   /bandeja                the list («Conversaciones») filtered by the search box: the address gets `?q=<text>` a moment
//                           after typing and «Cargando conversaciones» shows until the result is there. Each row names its
//                           mailbox (the channel's name, unique per test), which tells an email conversation apart even
//                           while the list still shows every conversation.
//   /bandeja/<id>           the thread's subject as a heading ([BAN-09]), each email as a card, the AI's draft «Borrador de
//                           la IA · pendiente de revisar» with the group «Revisar el borrador de la IA» («Aprobar y enviar»,
//                           «Editar», «Descartar»), and «IA en pausa hasta …».
//   The simulated sign-in pages (e2e/mocks/routes/google.mjs and microsoft.mjs): «Elige una cuenta» / «Elegir una cuenta»,
//   «Correo electrónico», «Continuar» / «Aceptar» and «Cancelar».
import { expect, type APIRequestContext, type Locator, type Page, type Request } from "@playwright/test";
import { untilWithQueue } from "./engine";
import { DEMO_URL, MOCK_URL } from "./env";
import type { EntraApp, GoogleClient } from "./email-mailboxes";
import { chooseOption, chosenLabel } from "./forms";
import { CONVERSATION_URL, conversationIdFromUrl, conversationLinks, conversationLog, searchInbox } from "./inbox";
import { clickAndWaitForPost } from "./ui";
import { channelPanelPath } from "./whatsapp";

export const NEW_EMAIL_PATH = "/canales/nuevo/correo";
export const GOOGLE_CALLBACK_PATH = "/api/oauth/google/callback";
export const MICROSOFT_CALLBACK_PATH = "/api/oauth/microsoft/callback";
/** The redirect URIs the business copies into Google Cloud and Entra: the installation's own address ([COR-02]). */
export const GOOGLE_REDIRECT_URI = `${DEMO_URL}${GOOGLE_CALLBACK_PATH}`;
export const MICROSOFT_REDIRECT_URI = `${DEMO_URL}${MICROSOFT_CALLBACK_PATH}`;

/** State of an AI reply waiting for a person ([CAN-07], [MOT-14]). */
export const DRAFT_STATE = "Borrador de la IA · pendiente de revisar";
/** Labels of Diagnóstico's ignored counters (src/server/channels/email/filters.ts, [COR-16]). */
export const IGNORE_LABELS = {
  mailingList: "Listas y boletines con enlace de baja",
  autoReply: "Respuestas automáticas",
  noReplySender: "Remitentes «noreply»",
} as const;

/**
 * Longest wait for a read of the mailbox: «Leer ahora» runs at the next turn of the background work, but when the
 * minute's recurring read holds the mailbox at that moment the next one comes a minute later (EMAIL_POLL_INTERVAL_MS).
 */
export const MAILBOX_READ_TIMEOUT_MS = 90_000;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const WIZARD_CHANNEL = new RegExp(`[?&]canal=(${UUID})`);
const MOCK_ORIGIN = new URL(MOCK_URL).origin;

function main(page: Page): Locator {
  return page.getByRole("main");
}

// ─── Wizard · Conectar ([COR-01]–[COR-03], [COR-07]) ────────────────────────────────────────────────────

export type EmailProviderLabel = "Gmail" | "Outlook / Microsoft 365";

/** Opens the wizard on a provider and names the mailbox. */
export async function startEmailWizard(page: Page, provider: EmailProviderLabel, name: string): Promise<void> {
  await page.goto(NEW_EMAIL_PATH);
  const picker = main(page).getByRole("combobox", { name: "Proveedor de correo" });
  if ((await chosenLabel(picker)) !== provider) await chooseOption(page, picker, provider);
  await main(page).getByLabel("Nombre", { exact: true }).fill(name);
}

/** The redirect URI the Gmail screen gives to copy ([COR-02]). */
export async function gmailRedirectUriShown(page: Page): Promise<string> {
  return main(page).getByLabel("URI de redirección autorizada", { exact: true }).inputValue();
}

/** Fills the business's own Google client and presses «Conectar con Google»: the browser leaves for Google. */
export async function submitGmailClient(page: Page, client: GoogleClient): Promise<void> {
  const form = main(page);
  await form.getByLabel("Client ID", { exact: true }).fill(client.clientId);
  await form.getByLabel("Client Secret", { exact: true }).fill(client.clientSecret);
  await form.getByRole("button", { name: "Conectar con Google" }).click();
}

/** Fills the business's own Entra app and presses «Conectar con Microsoft». */
export async function submitEntraApp(page: Page, app: EntraApp): Promise<void> {
  const form = main(page);
  await form.getByLabel("Client ID (Application ID)", { exact: true }).fill(app.clientId);
  await form.getByLabel("Client Secret", { exact: true }).fill(app.clientSecret);
  await form.getByLabel("Caducidad del Client Secret", { exact: true }).fill(app.secretExpiresOn);
  await form.getByLabel("Tenant ID", { exact: true }).fill(app.tenant);
  await form.getByRole("button", { name: "Conectar con Microsoft" }).click();
}

function onMock(page: Page, prefix: string): Promise<void> {
  return page.waitForURL((url) => url.origin === MOCK_ORIGIN && url.pathname.startsWith(prefix), { timeout: 20_000 });
}

/**
 * The person on Google's consent screen (simulated): the account and «Continuar», with every permission ticked unless
 * `untick` names some ([COR-03]). Returns the request the browser made to the app's callback.
 */
export async function consentAtGoogle(page: Page, address: string, options: { untick?: RegExp[] } = {}): Promise<Request> {
  await onMock(page, "/google-oauth/o/oauth2/v2/auth");
  await expect(page.getByRole("heading", { name: "Elige una cuenta" })).toBeVisible();
  await page.getByLabel("Correo electrónico", { exact: true }).fill(address);
  for (const permission of options.untick ?? []) await page.getByRole("checkbox", { name: permission }).uncheck();
  const callback = page.waitForRequest((request) => new URL(request.url()).pathname === GOOGLE_CALLBACK_PATH);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  return callback;
}

/** The person on Microsoft's «Elegir una cuenta» (simulated): the account and «Aceptar». */
export async function consentAtMicrosoft(page: Page, address: string): Promise<Request> {
  await onMock(page, "/ms-login/");
  await expect(page.getByRole("heading", { name: "Elegir una cuenta" })).toBeVisible();
  await page.getByLabel("Correo electrónico", { exact: true }).fill(address);
  const callback = page.waitForRequest((request) => new URL(request.url()).pathname === MICROSOFT_CALLBACK_PATH);
  await page.getByRole("button", { name: "Aceptar", exact: true }).click();
  return callback;
}

/** «Buzón conectado: <dirección>» at the top of «Respuestas y agente» once back from the provider. */
export function connectedSummary(page: Page): Locator {
  return main(page).getByRole("status", { name: "Buzón conectado" }).or(main(page).getByRole("region", { name: "Buzón conectado" })).first();
}

/** Back in the wizard with ?conexion=ok and the mailbox connected; returns the channel's id. */
export async function expectMailboxConnected(page: Page, address: string): Promise<string> {
  await page.waitForURL((url) => url.pathname === NEW_EMAIL_PATH && url.searchParams.get("conexion") !== null, { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("conexion"), `the return from the provider connected the mailbox (${page.url()})`).toBe("ok");
  await expect(connectedSummary(page)).toContainText(`Buzón conectado: ${address}`);
  const id = WIZARD_CHANNEL.exec(page.url())?.[1];
  if (!id) throw new Error(`No channel id in ${page.url()}`);
  return id;
}

export type RepliesStepOptions = {
  /** The active agent ([CAN-03]); none = the AI does not answer. */
  agentName?: string;
  /** «Modo de respuesta»; left as it is (drafts, [CAN-07]) when not given. */
  replyMode?: "draft" | "auto";
};

/** The «Borrador para revisar» / «Automático» radio of the replies step or the panel. */
export function replyModeRadio(page: Page, mode: "draft" | "auto"): Locator {
  return main(page).getByRole("radio", { name: mode === "auto" ? /^Automático/ : /^Borrador para revisar/ });
}

/** «Respuestas y agente»: the agent (saved when chosen), the reply mode, and «Guardar y terminar» → the panel. */
export async function finishRepliesStep(page: Page, channelId: string, options: RepliesStepOptions = {}): Promise<void> {
  if (options.agentName) {
    const picker = main(page).getByRole("combobox", { name: /^Agente activo/ });
    const saved = page.waitForResponse((response) => response.request().method() === "POST");
    await chooseOption(page, picker, options.agentName);
    await saved;
    await expect.poll(() => chosenLabel(picker), { message: "the active agent is saved" }).toBe(options.agentName);
  }
  if (options.replyMode) await replyModeRadio(page, options.replyMode).click();
  await clickAndWaitForPost(page, main(page).getByRole("button", { name: "Guardar y terminar" }));
  await expect(page).toHaveURL(new RegExp(`/canales/${channelId}(?:[?#]|$)`), { timeout: 20_000 });
}

export type MailboxSetup = { channelId: string; name: string; address: string };

/** Gmail end to end: the wizard, Google's consent with `address`, and the replies step. */
export async function connectGmailMailbox(page: Page, input: { name: string; address: string; client: GoogleClient } & RepliesStepOptions): Promise<MailboxSetup> {
  await startEmailWizard(page, "Gmail", input.name);
  await submitGmailClient(page, input.client);
  await consentAtGoogle(page, input.address);
  const channelId = await expectMailboxConnected(page, input.address);
  await finishRepliesStep(page, channelId, input);
  return { channelId, name: input.name, address: input.address };
}

/** Outlook end to end: the wizard, Microsoft's consent with `address`, and the replies step. */
export async function connectOutlookMailbox(page: Page, input: { name: string; address: string; app: EntraApp } & RepliesStepOptions): Promise<MailboxSetup> {
  await startEmailWizard(page, "Outlook / Microsoft 365", input.name);
  await submitEntraApp(page, input.app);
  await consentAtMicrosoft(page, input.address);
  const channelId = await expectMailboxConnected(page, input.address);
  await finishRepliesStep(page, channelId, input);
  return { channelId, name: input.name, address: input.address };
}

// ─── Panel ([CAN-15], [COR-16], [COR-22]) ───────────────────────────────────────────────────────────────

/**
 * «Leer ahora» in the mailbox's panel, then the background work runs until `done` (usually: the simulated mailbox saw
 * the app download the new email). Leaves the page on the panel.
 */
export async function readMailboxNow(page: Page, request: APIRequestContext, channelId: string, done: () => Promise<boolean>, message: string): Promise<void> {
  await page.goto(channelPanelPath(channelId));
  const button = main(page).getByRole("button", { name: "Leer ahora", exact: true });
  await expect(button).toBeEnabled();
  await clickAndWaitForPost(page, button);
  await untilWithQueue(request, done, message, MAILBOX_READ_TIMEOUT_MS);
}

/** An alert at the top of the mailbox's panel, by its title («Requiere reconexión», «Buzón conectado»…). */
export function panelAlert(page: Page, title: string): Locator {
  return main(page).getByRole("alert").filter({ hasText: title });
}

/** The count Diagnóstico shows for one reason of «Ignorados hasta ahora» ([COR-16]). */
export function ignoredCount(page: Page, label: string): Locator {
  const section = main(page).getByRole("region", { name: "Correos que la IA no contesta" });
  return section.locator("dl > div").filter({ has: page.getByRole("term").filter({ hasText: label }) }).getByRole("definition");
}

/** «Reconectar» → «Continuar con Google» → Google's consent → back to the panel ([COR-22]). */
export async function reconnectGmail(page: Page, channelId: string, address: string): Promise<void> {
  await page.goto(channelPanelPath(channelId));
  await panelAlert(page, "Requiere reconexión").getByRole("button", { name: "Reconectar" }).click();
  const dialog = page.getByRole("dialog", { name: "Conectar con Google" });
  await dialog.getByRole("button", { name: "Continuar con Google" }).click();
  await consentAtGoogle(page, address);
  await page.waitForURL((url) => url.pathname === channelPanelPath(channelId) && url.searchParams.get("conexion") !== null, { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("conexion"), "the mailbox is connected again").toBe("ok");
}

// ─── Bandeja ([BAN-09], [BAN-11], [COR-14], [COR-15]) ───────────────────────────────────────────────────

/** The inbox search's parameter and the list's loading state (src/app/(app)/bandeja/_lib/filters.ts, list-skeleton.tsx). */
const SEARCH_PARAM = "q";
const LIST_LOADING = "Cargando conversaciones";
/** The search box takes at most this many characters. */
const MAX_SEARCH = 100;
const SEARCH_RETRY = { timeout: 30_000, intervals: [1_000, 2_000] };

/**
 * Searches the inbox for `text` and waits for that search's own result: the box asks a moment after typing (the
 * address then carries it) and the list loads again. Until then the list shows every conversation, so counting or
 * clicking earlier reads the wrong list.
 */
async function searchedConversations(page: Page, text: string): Promise<Locator> {
  const links = await searchInbox(page, text);
  const search = text.trim().slice(0, MAX_SEARCH);
  await expect(page, "the list applies the search").toHaveURL((url) => url.searchParams.get(SEARCH_PARAM) === search, { timeout: 5_000 });
  await expect(page.getByRole("status", { name: LIST_LOADING }), "the list shows what the search found").toHaveCount(0, { timeout: 5_000 });
  return links;
}

/**
 * Finds the conversation of the mailbox `mailbox` whose emails contain `text` (unique per test) and opens it; searches
 * again while the email is being stored. The row is picked by its mailbox's name too, so a list that is still showing
 * every conversation (or shows them again) never gets the click. Returns the conversation's id.
 */
export async function openEmailConversation(page: Page, mailbox: Pick<MailboxSetup, "name">, text: string): Promise<string> {
  const row = conversationLinks(page).filter({ hasText: mailbox.name });
  await expect(async () => {
    const links = await searchedConversations(page, text);
    await expect(links, `one conversation has «${text}»`).toHaveCount(1, { timeout: 3_000 });
    await expect(row, `it is the one of «${mailbox.name}»`).toHaveCount(1, { timeout: 1_000 });
  }).toPass(SEARCH_RETRY);
  await row.click();
  await expect(page).toHaveURL(CONVERSATION_URL);
  await expect(conversationLog(page)).toContainText(text);
  return conversationIdFromUrl(page.url());
}

/** How many conversations the inbox search finds for `text`, once the list shows that search's result. */
export async function conversationsFound(page: Page, text: string): Promise<number> {
  let found = 0;
  await expect(async () => {
    found = await (await searchedConversations(page, text)).count();
  }).toPass(SEARCH_RETRY);
  return found;
}

/** The subject of the open thread, as its heading ([BAN-09]). */
export function threadSubject(page: Page, subject: string): Locator {
  return main(page).getByRole("heading", { name: subject, exact: true });
}

/** The AI's drafts waiting in the open conversation. */
export function aiDrafts(page: Page): Locator {
  return conversationLog(page).getByText(DRAFT_STATE);
}

/** «Aprobar y enviar» of the one draft waiting in the open conversation ([COR-15]). */
export async function approveDraft(page: Page): Promise<void> {
  const review = main(page).getByRole("group", { name: "Revisar el borrador de la IA" });
  await expect(review).toHaveCount(1);
  await clickAndWaitForPost(page, review.getByRole("button", { name: "Aprobar y enviar" }));
  await expect(aiDrafts(page)).toHaveCount(0, { timeout: 20_000 });
}
