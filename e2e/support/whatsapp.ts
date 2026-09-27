// WhatsApp as the team uses it ([WA-*], [CAN-*], [BAN-08]): the connection wizard, the number's panel, the inbox's 24 h
// window and templates, and Ajustes › WhatsApp. Locators follow docs/pantallas.md («Asistente de WhatsApp», «Panel del
// canal», «Conversación», «Ajustes»), DESIGN.md and src/app/(app)/canales/nuevo/whatsapp, src/app/(app)/canales/[id],
// src/app/(app)/bandeja/[id]/_whatsapp and src/app/(app)/ajustes/whatsapp, so a change of wording is fixed here:
//   /canales/nuevo/whatsapp   Paso 0 «Antes de empezar»: radio «Un número del negocio» / «Número de prueba de Meta» and
//                             the checkbox «Entiendo que este número dejará de funcionar…» ([WA-02]); «Continuar».
//                             Paso 1 «Datos del número»: «Nombre», «Token permanente», «App Secret…», «Phone Number ID»
//                             (and «Avanzado»: PIN, versión); «Validar con Meta» → «Negocio · Número · Estado» (a
//                             heading) or an alert with Meta's error in Spanish and «Código de Meta: …» ([WA-09]);
//                             «Conectar este número» → ?canal=<id>&paso=webhook.
//                             Paso 2 (paso=webhook): «Dirección de avisos de la app de Meta» — here (no public HTTPS) the
//                             manual way: «URL de devolución de llamada (Callback URL)» and «Token de verificación (Verify
//                             token)» to copy, «Esperando la verificación de Meta…» (role status) that turns into «Meta ha
//                             verificado la dirección» ([WA-13], [WA-16]); «App suscrita a la cuenta de WhatsApp Business»:
//                             «Suscrita y comprobada» or «Sin suscribir» with «Reintentar» ([WA-14]); «Continuar».
//                             Paso 3 (paso=activar): «Número registrado en la API de WhatsApp» or «Registrar el número»
//                             (a retry asks «¿Intentar registrar el número otra vez?», [WA-17], [WA-18]); the checklist
//                             «La app de Meta está publicada (Live)» and «He añadido el método de pago…» ([WA-21]);
//                             «Sincronizar plantillas» → «N plantillas sincronizadas, M aprobadas.» ([WA-22]); «Continuar».
//                             Paso 4 (paso=prueba): «Escribe «hola» a {número}», «Ha llegado tu mensaje» with the text,
//                             «Enviar respuesta de prueba» ([WA-23]); «Seguir sin probar» while nothing arrived.
//                             Paso 5 (paso=agente): «Agente activo» and «IA del canal» (saved at once), «Solo a estos
//                             números» (switch, on) and «Números que pueden probar la IA»; «Terminar» → /canales/[id] ([WA-25]).
//   /canales/[id]             the WhatsApp panel: one traffic light per check (label and «Correcto», «Aviso», «Error» or
//                             «Sin comprobar», DESIGN.md «Insignias y semáforos»), «Revalidar», «Pausar IA», «Desconectar»
//                             (name to confirm, «Dar de baja también el número en Meta», then «Desconectar y dar de baja»)
//                             ([WA-26]–[WA-28]).
//   /bandeja/[id]             the 24 h window («Ventana abierta hasta … · quedan …» or «La ventana de 24 h está cerrada…»,
//                             [BAN-08]); closed, the composer only keeps internal notes and «Elegir plantilla» opens «Enviar una
//                             plantilla» with «Plantilla» and one field per variable («{{nombre}} · texto»), «Enviar
//                             plantilla» ([WA-43]); a sent message shows its cost «≈ 0,0087 US$ estimado · Servicio» ([WA-47]).
//   /ajustes/whatsapp         «Tarifas»: market, category and price per message ([AJU-09]).
import { expect, type Locator, type Page } from "@playwright/test";
import { channelCard, CHANNELS_PATH } from "./channels";
import { chooseOption } from "./forms";
import { META, META_TOKENS, type WaNumber } from "./whatsapp-meta";
import { clickAndWaitForPost, escapeRegExp } from "./ui";

export const NEW_WHATSAPP_PATH = "/canales/nuevo/whatsapp";
export const WHATSAPP_SETTINGS_PATH = "/ajustes/whatsapp";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** The wizard's address once the channel exists ([WA-01]): ?canal=<id>&paso=<step>. */
const WIZARD_CHANNEL_URL = new RegExp(`[?&]canal=(${UUID})`);
const CHANNEL_PANEL_URL = new RegExp(`/canales/(${UUID})(?:[/?#]|$)`);

function main(page: Page): Locator {
  return page.getByRole("main");
}

export function channelPanelPath(channelId: string, tab = ""): string {
  return tab ? `${CHANNELS_PATH}/${channelId}/${tab}` : `${CHANNELS_PATH}/${channelId}`;
}

export function wizardStepPath(channelId: string, step: "webhook" | "activar" | "prueba" | "agente"): string {
  return `${NEW_WHATSAPP_PATH}?${new URLSearchParams({ canal: channelId, paso: step }).toString()}`;
}

/** «Continuar» of the current step: a button, or a link once the step is done. */
export function wizardContinue(page: Page): Locator {
  const name = /^(Continuar|Siguiente)$/;
  return main(page).getByRole("link", { name }).or(main(page).getByRole("button", { name })).last();
}

/** Presses «Continuar» and waits for the next step. */
export async function continueWizard(page: Page): Promise<void> {
  const next = wizardContinue(page);
  await expect(next, "«Continuar» is enabled").toBeEnabled({ timeout: 15_000 });
  const before = page.url();
  await next.click();
  await expect.poll(() => page.url(), { message: "the wizard moves to the next step" }).not.toBe(before);
}

// ─── Paso 0 · Aviso ([WA-02], [WA-03]) ──────────────────────────────────────────────────────────────────

/** The checkbox that says the number leaves the phone app. */
export function understoodCheckbox(page: Page): Locator {
  return main(page).getByRole("checkbox", { name: /^Entiendo que este número dejará de funcionar/ });
}

/** Opens the wizard and passes the notice (ticking that it is understood). */
export async function passNumberNotice(page: Page, options: { metaTestNumber?: boolean } = {}): Promise<void> {
  await page.goto(NEW_WHATSAPP_PATH);
  if (options.metaTestNumber) await main(page).getByRole("radio", { name: "Número de prueba de Meta" }).check();
  await understoodCheckbox(page).check();
  await main(page).getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(main(page).getByRole("heading", { name: "Datos del número" })).toBeVisible();
}

// ─── Paso 1 · Datos ([WA-04]–[WA-11]) ───────────────────────────────────────────────────────────────────

export type NumberData = { name: string; token: string; appSecret?: string; phoneNumberId: string };

export async function fillNumberData(page: Page, data: NumberData): Promise<void> {
  const form = main(page);
  await form.getByLabel(/^Nombre/).fill(data.name);
  await form.getByLabel(/^Token permanente/).fill(data.token);
  if (data.appSecret !== undefined) await form.getByLabel(/^App Secret/).fill(data.appSecret);
  await form.getByLabel(/^Phone Number ID/).fill(data.phoneNumberId);
}

/** «Validar con Meta» and its answer. */
export async function validateWithMeta(page: Page): Promise<void> {
  await clickAndWaitForPost(page, main(page).getByRole("button", { name: /^Validar (con Meta|de nuevo)$/ }));
}

/** «Negocio · Número · Estado» after a validation ([WA-08]). */
export function validationSummary(page: Page): Locator {
  return main(page).getByRole("region", { name: / · / }).or(main(page).locator("section").filter({ has: page.getByText("Meta ha validado los datos") })).first();
}

/** Meta's refusal in Spanish ([WA-09]): the alert of the form. */
export function validationError(page: Page): Locator {
  return main(page).getByRole("alert").filter({ hasText: /Meta|token|App Secret|Phone Number ID/i }).first();
}

/** «Conectar este número»: stores the channel and opens its webhook step; returns the channel's id. */
export async function connectValidatedNumber(page: Page): Promise<string> {
  await clickAndWaitForPost(page, main(page).getByRole("button", { name: "Conectar este número" }));
  await expect(page).toHaveURL(WIZARD_CHANNEL_URL, { timeout: 20_000 });
  const id = WIZARD_CHANNEL_URL.exec(page.url())?.[1];
  if (!id) throw new Error(`No channel id in ${page.url()}`);
  return id;
}

// ─── Paso 2 · Webhook ([WA-12]–[WA-16]) ─────────────────────────────────────────────────────────────────

/** The address and verify token to copy into Meta (the manual way). */
export async function webhookValuesToCopy(page: Page): Promise<{ callbackUrl: string; verifyToken: string }> {
  const url = main(page).getByLabel(/URL de devoluci[oó]n de llamada|Callback URL/i);
  const token = main(page).getByLabel(/Token de verificaci[oó]n|Verify token/i);
  await expect(url).toBeVisible({ timeout: 15_000 });
  return { callbackUrl: await url.inputValue(), verifyToken: await token.inputValue() };
}

/** The live wait for Meta's verification ([WA-13]). */
export function verificationPending(page: Page): Locator {
  return main(page).getByRole("status").filter({ hasText: /Esperando la verificaci[oó]n de Meta/ });
}

/** «Meta ha verificado la dirección». */
export function verificationReceived(page: Page): Locator {
  return main(page).getByText(/Meta ha verificado la direcci[oó]n/).first();
}

/** The WABA subscription, checked ([WA-14]). */
export function wabaSubscribed(page: Page): Locator {
  return main(page).getByText("Suscrita y comprobada", { exact: true });
}

export function wabaNotSubscribed(page: Page): Locator {
  return main(page).getByText("Sin suscribir", { exact: true });
}

// ─── Paso 3 · Activar ([WA-17]–[WA-22]) ─────────────────────────────────────────────────────────────────

/** «Número registrado en la API de WhatsApp» ([WA-17]). */
export function numberRegistered(page: Page): Locator {
  return main(page).getByText("Número registrado en la API de WhatsApp", { exact: true });
}

/** «Registrar el número» (or «Registrar otra vez» after a failure). */
export function registerButton(page: Page): Locator {
  return main(page).getByRole("button", { name: /^Registrar (el número|otra vez)$/ });
}

/** «N plantillas sincronizadas, M aprobadas.» after «Sincronizar plantillas» ([WA-22]). */
export function templatesSynced(page: Page): Locator {
  return main(page).getByText(/\d+ plantillas sincronizadas, \d+ aprobadas/).first();
}

/** Ticks a checklist item (saved at once) unless it already is ([WA-21]). */
async function tickChecklist(page: Page, name: RegExp): Promise<void> {
  const box = main(page).getByRole("checkbox", { name }).first();
  if (await box.isChecked()) return;
  await clickAndWaitForPost(page, box);
  await expect(box).toBeChecked();
}

/**
 * Paso 3: registers the number when Meta says it is not (confirming a retry if the wizard asks), ticks «App publicada
 * (Live)» and «Método de pago» and syncs the templates.
 */
export async function activateNumber(page: Page): Promise<void> {
  // The step reads the number from Meta on arrival: registered, or «Registrar el número».
  await expect(numberRegistered(page).or(registerButton(page)).first()).toBeVisible({ timeout: 20_000 });
  if (await registerButton(page).isVisible()) {
    await registerButton(page).click();
    const confirm = page.getByRole("alertdialog", { name: /registrar el número otra vez/ });
    await expect(numberRegistered(page).or(confirm).first()).toBeVisible({ timeout: 20_000 });
    if (await confirm.isVisible()) await clickAndWaitForPost(page, confirm.getByRole("button", { name: "Intentar otra vez" }));
  }
  await expect(numberRegistered(page), "[WA-17] the number is registered").toBeVisible({ timeout: 20_000 });
  await tickChecklist(page, /publicada \(Live\)/);
  await tickChecklist(page, /m[eé]todo de pago/i);
  await clickAndWaitForPost(page, main(page).getByRole("button", { name: "Sincronizar plantillas" }));
  await expect(templatesSynced(page), "[WA-22] the templates are synced").toBeVisible();
}

// ─── Paso 4 · Prueba ([WA-23]) ──────────────────────────────────────────────────────────────────────────

/** «Escribe «hola» a {número}». */
export function writeHolaInstruction(page: Page, number: WaNumber): Locator {
  return main(page).getByText(new RegExp(`Escribe.*hola.*${escapeRegExp(number.displayPhoneNumber)}`)).first();
}

/** «Ha llegado tu mensaje» with the text that arrived. */
export function testMessageArrived(page: Page): Locator {
  return main(page).getByText("Ha llegado tu mensaje", { exact: true });
}

export function sendTestReplyButton(page: Page): Locator {
  return main(page).getByRole("button", { name: /^Enviar respuesta de prueba$/ });
}

/** Leaves the test step without a message («Seguir sin probar»). */
export async function skipTestStep(page: Page): Promise<void> {
  const skip = main(page).getByRole("link", { name: "Seguir sin probar" });
  await expect(skip).toBeVisible();
  const before = page.url();
  await skip.click();
  await expect.poll(() => page.url(), { message: "the wizard moves to the agent step" }).not.toBe(before);
}

// ─── Paso 5 · Agente ([WA-25], [CAN-06]) ────────────────────────────────────────────────────────────────

export type AgentStepOptions = {
  /** The active agent; none = the AI does not answer ([CAN-03]). */
  agentName?: string;
  /** «IA del canal»; left as it is when not given. */
  aiEnabled?: boolean;
  /** Test mode «solo a estos números» (on by default, [WA-25]). */
  testMode?: boolean;
  /** The numbers (or BSUIDs) the AI may answer while in test mode. */
  allowlist?: readonly string[];
};

/** The test-mode switch: «Solo a estos números» in the wizard, «Modo pruebas» in the channel's Configuración. */
function testModeSwitch(page: Page): Locator {
  return main(page).getByRole("switch", { name: /^(Solo a estos n[uú]meros|Modo pruebas)/ });
}

/** The list of test mode: «Números que pueden probar la IA» in the wizard, «Solo a estos contactos» in Configuración. */
function allowlistBox(page: Page): Locator {
  return main(page).getByRole("textbox", { name: /^(N[uú]meros que pueden probar la IA|Solo a estos (n[uú]meros|contactos))/ });
}

/** A switch whose change is only saved later (with «Terminar» or «Guardar cambios»). */
async function setSwitch(control: Locator, on: boolean): Promise<void> {
  if ((await control.getAttribute("aria-checked")) !== String(on)) await control.click();
  await expect(control).toHaveAttribute("aria-checked", String(on));
}

/** Paso 5: agent and AI (each saved at once, as on the channel card) and test mode; «Terminar» opens the panel. */
export async function finishAgentStep(page: Page, options: AgentStepOptions): Promise<void> {
  const step = main(page);
  // [WA-25] Test mode starts on.
  await expect(testModeSwitch(page), "[WA-25] test mode is on by default").toHaveAttribute("aria-checked", "true");
  if (options.agentName) {
    const picker = step.getByRole("combobox", { name: /^Agente activo/ });
    await Promise.all([page.waitForResponse((response) => response.request().method() === "POST"), chooseOption(page, picker, options.agentName)]);
  }
  const ai = step.getByRole("switch", { name: /^IA del canal/ });
  if (options.aiEnabled !== undefined && (await ai.getAttribute("aria-checked")) !== String(options.aiEnabled)) {
    await clickAndWaitForPost(page, ai);
    await expect(ai).toHaveAttribute("aria-checked", String(options.aiEnabled));
  }
  await setSwitch(testModeSwitch(page), options.testMode ?? true);
  if ((options.testMode ?? true) && options.allowlist) await allowlistBox(page).fill(options.allowlist.join("\n"));
  // «Terminar» saves what changed and goes to the number's panel.
  await step.getByRole("button", { name: "Terminar", exact: true }).click();
  await expect(page).toHaveURL(CHANNEL_PANEL_URL, { timeout: 20_000 });
}

// ─── The whole wizard ───────────────────────────────────────────────────────────────────────────────────

export type ConnectOptions = AgentStepOptions & { token?: string };

/**
 * Canales › Añadir › WhatsApp from start to end with the simulated Meta: notice, data validated with Meta, webhook (the
 * WABA subscription is automatic; the app's address is manual here, [WA-16]), activation (registration, checklist,
 * templates), no test message, and the agent step. Returns the channel's id.
 */
export async function connectWhatsAppNumber(page: Page, number: WaNumber, options: ConnectOptions = {}): Promise<string> {
  await passNumberNotice(page);
  await fillNumberData(page, { name: number.name, token: options.token ?? META_TOKENS.valid, appSecret: META.appSecret, phoneNumberId: number.phoneNumberId });
  await validateWithMeta(page);
  await expect(validationSummary(page)).toContainText(number.displayPhoneNumber);
  const channelId = await connectValidatedNumber(page);
  await expect(wabaSubscribed(page)).toBeVisible({ timeout: 20_000 });
  await continueWizard(page);
  await activateNumber(page);
  await continueWizard(page);
  await skipTestStep(page);
  await finishAgentStep(page, options);
  return channelId;
}

// ─── Panel ([WA-26]–[WA-28]) ────────────────────────────────────────────────────────────────────────────

/** The word of each traffic-light state (src/components/status-light.tsx). */
export const LIGHT_WORDS = { ok: "Correcto", warn: "Aviso", error: "Error", off: "Sin comprobar" } as const;
export type LightState = keyof typeof LIGHT_WORDS;

/** A traffic light of the panel by its name («Token», «Registro», «Calidad»…): its name and state word together. */
export function healthLight(page: Page, label: string): Locator {
  const words = Object.values(LIGHT_WORDS).map(escapeRegExp).join("|");
  return main(page).getByText(new RegExp(`^${escapeRegExp(label)}\\s*(${words}|Comprobando…)$`)).first();
}

/** Expects a light in a state (reloading while a check runs). */
export async function expectLight(page: Page, label: string, state: LightState): Promise<void> {
  await expect(healthLight(page, label), `the light «${label}» is «${LIGHT_WORDS[state]}»`).toHaveText(new RegExp(`${escapeRegExp(LIGHT_WORDS[state])}$`));
}

/** «Revalidar» ([WA-27]): the stored credentials against Meta and every light now. */
export async function revalidateNumber(page: Page, channelId: string): Promise<void> {
  await page.goto(channelPanelPath(channelId));
  await clickAndWaitForPost(page, main(page).getByRole("button", { name: /^Revalidar$/ }));
  // The first POST may be another action of the page (the bell loads its notices with one): wait for this one's answer.
  await expect(page.getByText(/^Revalidado con Meta/).first(), "«Revalidar» answered").toBeVisible({ timeout: 15_000 });
}

/**
 * «Desconectar» ([WA-28]): writes the channel's name to confirm and, with `removeFromMeta`, ticks «Dar de baja también el
 * número en Meta», which asks a second time («Desconectar y dar de baja») before leaving Meta.
 */
export async function disconnectNumber(page: Page, channelId: string, channelName: string, options: { removeFromMeta: boolean }): Promise<void> {
  await page.goto(channelPanelPath(channelId));
  await main(page).getByRole("button", { name: "Desconectar", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const fromMeta = dialog.getByRole("checkbox", { name: /^Dar de baja también el número en Meta/ });
  if ((await fromMeta.isChecked()) !== options.removeFromMeta) await fromMeta.click();
  await dialog.getByRole("textbox", { name: /^Escribe .* para confirmar/ }).fill(channelName);
  const confirm = dialog.getByRole("button", { name: "Desconectar", exact: true });
  if (options.removeFromMeta) {
    await confirm.click();
    await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Desconectar y dar de baja" }));
  } else {
    await clickAndWaitForPost(page, confirm);
  }
  await expect(dialog).toHaveCount(0);
}

/**
 * Leaves the test's channel «Desactivado» (Resumen › «Desactivar», [CAN-16]): it neither answers nor sends and its
 * background checks stop calling Meta, so later tests only see their own calls. Best effort: it never fails a test.
 */
export async function disableChannelQuietly(page: Page, channelId: string | null): Promise<void> {
  if (!channelId) return;
  try {
    await page.goto(channelPanelPath(channelId));
    const disable = main(page).getByRole("button", { name: "Desactivar", exact: true });
    if (!(await disable.isVisible())) return;
    await disable.click();
    await clickAndWaitForPost(page, page.getByRole("alertdialog").getByRole("button", { name: "Desactivar", exact: true }));
  } catch {
    // The next test uses its own number anyway.
  }
}

/** The channel's card in /canales shows this state ([CAN-01]). */
export async function expectChannelState(page: Page, channelName: string, state: RegExp): Promise<void> {
  await page.goto(CHANNELS_PATH);
  await expect(channelCard(page, channelName)).toContainText(state);
}

/** «Modo pruebas» and «Solo a estos contactos» in the channel's Configuración ([CAN-06]). */
export async function setTestAllowlist(page: Page, channelId: string, entries: readonly string[]): Promise<void> {
  await page.goto(channelPanelPath(channelId, "configuracion"));
  await setSwitch(testModeSwitch(page), true);
  await allowlistBox(page).fill(entries.join("\n"));
  await clickAndWaitForPost(page, page.getByRole("button", { name: /^Guardar( cambios)?$/ }).first());
}

// ─── Bandeja: 24 h window and templates ([BAN-08], [WA-43]) ─────────────────────────────────────────────

/** «Ventana abierta hasta … · quedan …» or «La ventana de 24 h está cerrada: …». */
export function windowIndicator(page: Page): Locator {
  return main(page).getByText(/^Ventana abierta hasta|^La ventana de 24 h está cerrada/).first();
}

/** «Elegir plantilla» (only in WhatsApp, [CAN-14]). */
export function chooseTemplateButton(page: Page): Locator {
  return main(page).getByRole("button", { name: "Elegir plantilla" });
}

/** Sends an approved template with its variables from «Enviar una plantilla». */
export async function sendTemplate(page: Page, template: string, values: Record<string, string>): Promise<void> {
  await chooseTemplateButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Enviar una plantilla" });
  await expect(dialog).toBeVisible();
  await chooseOption(page, dialog.getByRole("combobox", { name: "Plantilla" }), new RegExp(`^${escapeRegExp(template)} · `));
  for (const [name, value] of Object.entries(values)) {
    await dialog.getByRole("textbox", { name: new RegExp(`^\\{\\{${escapeRegExp(name)}\\}\\}`) }).fill(value);
  }
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Enviar plantilla" }));
  await expect(dialog).toHaveCount(0);
}

/** The template names «Plantilla» offers ([WA-43]: only approved ones). */
export async function offeredTemplates(page: Page): Promise<string[]> {
  await chooseTemplateButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Enviar una plantilla" });
  await dialog.getByRole("combobox", { name: "Plantilla" }).click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  const labels = (await options.allInnerTexts()).map((label) => label.split(" · ")[0].trim());
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  return labels;
}

// ─── Ajustes › WhatsApp ([AJU-09]) ──────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = { service: "Servicio", utility: "Utilidad", marketing: "Marketing", authentication: "Autenticación" } as const;

/**
 * «Añadir o cambiar una tarifa»: «Mercado» (the country's two letters), «Categoría de Meta» and «Precio por mensaje» in
 * US$, as a person types it («0,0087»); «Guardar tarifa» replaces the rate of that market and category.
 */
export async function saveWhatsAppRate(page: Page, rate: { country: string; category: keyof typeof CATEGORY_LABELS; price: string }): Promise<void> {
  await page.goto(WHATSAPP_SETTINGS_PATH);
  const settings = main(page);
  await settings.getByRole("textbox", { name: "Mercado", exact: true }).fill(rate.country);
  await chooseOption(page, settings.getByRole("combobox", { name: "Categoría de Meta" }), CATEGORY_LABELS[rate.category]);
  await settings.getByRole("textbox", { name: "Precio por mensaje" }).fill(rate.price);
  await clickAndWaitForPost(page, settings.getByRole("button", { name: "Guardar tarifa" }));
  // The rate shows in the list with all its decimals («0,0087 US$»).
  await expect(settings.getByText(new RegExp(`${escapeRegExp(rate.price.replace(".", ","))}\\s*US\\$`)).first()).toBeVisible();
}
