// What a person does in Agentes ([AGE-*], [MOD-*], [PRU-*]), in one place. Locators follow the screens of
// docs/pantallas.md «Agentes» and DESIGN.md (accessible names, the save bar «Cambios sin guardar · Descartar ·
// Guardar cambios», confirmations with the exact verb), so a change of wording is fixed here and not in every spec:
//   /agentes              one card (list item) per agent with its name as a link and its model; «Nuevo agente»;
//                         «Acciones de …» → «Borrar» (confirmation that asks to type the name).
//   /agentes/nuevo        «¿Cómo quieres empezar?»: «Plantilla de <sector>», «Plantilla de otro sector» (+ «Sector»),
//                         «En blanco», «Generar borrador con IA»; «Nombre del agente»; «Crear agente» → the editor.
//   /agentes/[id]/…       «Secciones del agente»: General, Instrucciones, Modelo, Conocimiento, Herramientas, Traspaso,
//                         Canales, Probar, Versiones; «Solo lectura» for who can only look.
//   Modelo                pickers «Modelo principal» and «Modelo de respaldo» (combobox → listbox of options).
//   Versiones             «Versión N» with date and author; «Ver» → «Restaurar esta versión» → «Restaurar».
//   Probar                «Simular canal» (radio group), «Mensaje de prueba», «Enviar», «Empezar de nuevo», the
//                         «Conversación de prueba» log and «Detalles de la respuesta».
import { createHash } from "node:crypto";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { RUN_ID } from "./env";
import { clickAndWaitForPost, escapeRegExp } from "./ui";

export const AGENTS_PATH = "/agentes";
export const NEW_AGENT_PATH = "/agentes/nuevo";

/** Tabs of the editor, each with its own address (docs/pantallas.md «Editor del agente»). */
export const EDITOR_TABS = {
  general: { label: "General", segment: "" },
  instrucciones: { label: "Instrucciones", segment: "/instrucciones" },
  modelo: { label: "Modelo", segment: "/modelo" },
  herramientas: { label: "Herramientas", segment: "/herramientas" },
  traspaso: { label: "Traspaso", segment: "/traspaso" },
  canales: { label: "Canales", segment: "/canales" },
  probar: { label: "Probar", segment: "/probar" },
  versiones: { label: "Versiones", segment: "/versiones" },
} as const;
export type EditorTab = keyof typeof EDITOR_TABS;

export function agentPath(agentId: string, tab: EditorTab = "general"): string {
  return `${AGENTS_PATH}/${agentId}${EDITOR_TABS[tab].segment}`;
}

const AGENT_EDITOR_URL = /\/agentes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/;

export function agentIdFromUrl(url: string): string {
  const id = AGENT_EDITOR_URL.exec(url)?.[1];
  if (!id) throw new Error(`Not an agent editor address: ${url}`);
  return id;
}

/**
 * The demo is a hair salon (seed, docs/spec.md [ARR-06]); its template ([AGE-02], src/lib/sectors/peluqueria.ts) is
 * «Asistente de citas», whose role talks about «la peluquería».
 */
export const DEMO_TEMPLATE = { sectorLabel: "Peluquería/Estética", agentName: "Asistente de citas", roleMentions: /peluquer[ií]a/i } as const;

/** A name no other test (or the demo) uses, so the agent can be found in lists: «Agente e2e 3fa2c1». */
export function uniqueAgentName(testInfo: TestInfo, label = "Agente e2e"): string {
  const suffix = createHash("sha256").update(`${RUN_ID}:${testInfo.testId}:${testInfo.retry}:${label}`).digest("hex").slice(0, 6);
  return `${label} ${suffix}`;
}

const CREATE_AGENT = /^Crear( el)? agente$/;
const SAVE = /^Guardar( cambios)?$/;

/** The save bar of an editor tab, present only while there are unsaved changes (DESIGN.md «Barra de guardado»). */
export function unsavedChangesBar(page: Page): Locator {
  return page.getByRole("region", { name: "Cambios sin guardar" });
}

/**
 * «Nuevo agente» from the template of the business's sector ([AGE-02]), optionally with its own name; returns the id
 * of the editor it opens. The agent starts at version 1.
 */
export async function createAgentFromTemplate(page: Page, options: { name?: string } = {}): Promise<string> {
  await page.goto(NEW_AGENT_PATH);
  await page.getByRole("radio", { name: new RegExp(escapeRegExp(DEMO_TEMPLATE.sectorLabel)) }).check();
  const name = page.getByLabel("Nombre del agente", { exact: true });
  if (options.name) await name.fill(options.name);
  else await expect(name).toHaveValue(DEMO_TEMPLATE.agentName);
  await clickAndWaitForPost(page, page.getByRole("button", { name: CREATE_AGENT }));
  await expect(page).toHaveURL(AGENT_EDITOR_URL);
  return agentIdFromUrl(page.url());
}

/** «Guardar cambios» of the editor's save bar. */
export function saveButton(page: Page): Locator {
  return unsavedChangesBar(page).getByRole("button", { name: SAVE });
}

/** Presses «Guardar cambios» and waits for the save to be answered. */
export async function saveEditor(page: Page): Promise<void> {
  await clickAndWaitForPost(page, saveButton(page));
}

/** Saved without errors: the save bar is gone. */
export async function expectSaved(page: Page): Promise<void> {
  await expect(unsavedChangesBar(page)).toHaveCount(0);
}

/** General › Nombre, saved. */
export async function renameAgent(page: Page, agentId: string, name: string): Promise<void> {
  await page.goto(agentPath(agentId));
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await saveEditor(page);
  await expectSaved(page);
}

/** An agent from the demo template with a name of its own (version 1); the page is left on its editor. */
export async function createNamedAgent(page: Page, name: string): Promise<string> {
  return createAgentFromTemplate(page, { name });
}

/** Guided instruction field of the Instrucciones tab ([AGE-04]): «Rol», «Qué puede hacer»… */
export function instructionField(page: Page, label: RegExp | string): Locator {
  return page.getByLabel(label, typeof label === "string" ? { exact: true } : undefined);
}

/**
 * Instrucciones › «Generar borrador con IA» from a description ([AGE-05]): the draft fills the fields and the dialog
 * closes; nothing is saved yet.
 */
export async function generateDraftFromDescription(page: Page, description: string): Promise<void> {
  await page.getByRole("button", { name: "Generar borrador con IA" }).click();
  const dialog = page.getByRole("dialog", { name: "Generar borrador con IA" });
  await dialog.getByRole("radio", { name: "Desde una descripción" }).click();
  await dialog.getByLabel("Describe tu negocio", { exact: true }).fill(description);
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Generar borrador", exact: true }));
  await expect(dialog).toHaveCount(0);
}

/** The card of an agent in /agentes (names in the tests are unique). */
export function agentCard(page: Page, name: string): Locator {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
}

/** «Borrar» from the card's menu, confirmed by typing the name when the dialog asks for it ([AGE-13]). */
export async function deleteAgentFromList(page: Page, name: string): Promise<Locator> {
  await agentCard(page, name).getByRole("button", { name: /acciones|opciones|más/i }).click();
  await page.getByRole("menuitem", { name: /^Borrar/ }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  const typeName = confirm.getByRole("textbox");
  if ((await typeName.count()) > 0) await typeName.fill(name);
  return confirm;
}

// ─── Versiones ([AGE-12]) ───────────────────────────────────────────────────────────────────────────────

/** «Versión 2» in the history of Versiones. */
export function versionEntry(page: Page, version: number): Locator {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ hasText: new RegExp(`Versión ${version}(?!\\d)`) })
    .last();
}

/** Opens a version («Ver») to see what restoring it would change. */
export async function openVersion(page: Page, agentId: string, version: number): Promise<void> {
  await page.goto(`${agentPath(agentId, "versiones")}?version=${version}`);
  await expect(page.getByRole("heading", { name: `Versión ${version}`, exact: true })).toBeVisible();
}

/** «Restaurar esta versión» and its confirmation. */
export async function restoreVersion(page: Page, agentId: string, version: number): Promise<void> {
  await openVersion(page, agentId, version);
  await page.getByRole("button", { name: /^Restaurar/ }).click();
  const confirm = page.getByRole("alertdialog");
  await clickAndWaitForPost(page, confirm.getByRole("button", { name: /^Restaurar/ }));
  await expect(confirm).toHaveCount(0);
}

// ─── Modelo ([MOD-01]–[MOD-07]) ─────────────────────────────────────────────────────────────────────────

export type ModelRole = "primary" | "fallback";

/** The picker of the Modelo tab: a combobox labelled «Modelo principal» or «Modelo de respaldo». */
export function modelPicker(page: Page, role: ModelRole): Locator {
  return page.getByRole("combobox", { name: role === "primary" ? /principal/i : /respaldo/i });
}

/** Opens a picker and returns its list of options. */
export async function openModelPicker(page: Page, role: ModelRole): Promise<Locator> {
  await modelPicker(page, role).click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  return list;
}

/** The option of a model, by the name OpenRouter gives it without the provider («GPT-5.6 Luna»). */
export function modelOption(list: Locator, modelName: string): Locator {
  return list.getByRole("option", { name: new RegExp(escapeRegExp(modelName)) });
}

export async function closeModelPicker(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

export async function chooseModel(page: Page, role: ModelRole, modelName: string): Promise<void> {
  const list = await openModelPicker(page, role);
  await modelOption(list, modelName).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(modelPicker(page, role)).toContainText(modelName);
}

/** The search box of an open picker. */
export function modelSearch(page: Page): Locator {
  return page.getByRole("combobox", { name: "Buscar modelo" }).or(page.getByPlaceholder(/busca/i)).first();
}

// ─── Probar ([PRU-01]–[PRU-07]) ─────────────────────────────────────────────────────────────────────────

export type SimulatedChannelLabel = "WhatsApp" | "Correo" | "Chat web";

export function testChatLog(page: Page): Locator {
  return page.getByRole("log", { name: "Conversación de prueba" });
}

export function testMessageBox(page: Page): Locator {
  return page.getByLabel("Mensaje de prueba", { exact: true });
}

export function sendButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Enviar$/ });
}

/** Types a customer message in Probar and sends it; the reply (or the error) comes back in the same POST. */
export async function sendTestMessage(page: Page, text: string): Promise<void> {
  await testMessageBox(page).fill(text);
  await clickAndWaitForPost(page, sendButton(page));
}

/** «Simular canal» ([PRU-03]). */
export async function simulateChannel(page: Page, label: SimulatedChannelLabel): Promise<void> {
  const group = page.getByRole("radiogroup", { name: "Simular canal" });
  const option = group.getByRole("radio", { name: label, exact: true });
  await option.click();
  await expect(option).toHaveAttribute("aria-checked", "true");
}

/** «Detalles de la respuesta» ([PRU-02]): model, tokens, cost, time and tools of the selected reply. */
export function replyDetails(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: "Detalles de la respuesta" }) });
}

/** An amount in US dollars as DESIGN.md writes it («0,00031 US$»). */
export function usd(amount: string): RegExp {
  return new RegExp(`${escapeRegExp(amount)}\\s*US\\$`);
}
