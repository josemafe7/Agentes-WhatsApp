// What a person does with the internal agents ([INT-*]), in one place. Locators follow the screens of
// docs/pantallas.md «Asistentes» and «Editor del agente» (accessible names), so a change of wording is fixed here:
//   /agentes/nuevo            «¿Para quién es?»: «Para clientes» or «Interno, para tu equipo»; «Nombre del agente».
//   /agentes/[id]/acceso      «Acceso»: «Todo el equipo» or «Personas concretas» (+ one checkbox per person);
//                             «Guardar acceso».
//   /conocimiento             «Nueva base» → «Uso»: «Para clientes» or «Interna».
//   /asistentes               one card (list item) per internal agent the person may use, its name as a link.
//   /asistentes/[id]          «Tus conversaciones» (links, «Borrar la conversación …»), «Nueva conversación», the
//                             log «Conversación con <nombre>», «Tu pregunta», «Enviar», «Ver la fuente».
import { expect, type Locator, type Page } from "@playwright/test";
import { agentIdFromUrl, AGENTS_PATH, NEW_AGENT_PATH } from "./agents";
import { KNOWLEDGE_PATH } from "./knowledge";
import { clickAndWaitForPost, escapeRegExp } from "./ui";

export const ASSISTANTS_PATH = "/asistentes";
export const NOT_FOUND = "Esta página no existe";
export const DEMO_INTERNAL_AGENT = "Asistente del equipo";
export const DEMO_INTERNAL_BASE = "Manual interno";

const AGENT_EDITOR_URL = /\/agentes\/[0-9a-f-]{36}(?:[/?#]|$)/;
const BASE_URL = /\/conocimiento\/([0-9a-f-]{36})(?:[/?#]|$)/;

export function assistantPath(agentId: string): string {
  return `${ASSISTANTS_PATH}/${agentId}`;
}

export function agentAccessPath(agentId: string): string {
  return `${AGENTS_PATH}/${agentId}/acceso`;
}

/** «Nuevo agente» › «Interno, para tu equipo» ([INT-01]); returns the id of the editor it opens. */
export async function createInternalAgent(page: Page, name: string): Promise<string> {
  await page.goto(NEW_AGENT_PATH);
  await page.getByRole("radio", { name: /^Interno/ }).check();
  await page.getByLabel("Nombre del agente", { exact: true }).fill(name);
  await clickAndWaitForPost(page, page.getByRole("button", { name: /^Crear( el)? agente$/ }));
  await expect(page).toHaveURL(AGENT_EDITOR_URL);
  return agentIdFromUrl(page.url());
}

/** «Nueva base» with «Uso»: «Interna» ([INT-04]); returns its id. */
export async function createInternalBase(page: Page, name: string): Promise<string> {
  await page.goto(KNOWLEDGE_PATH);
  await page
    .getByRole("main")
    .getByRole("button", { name: /^(Nueva base|Crear (una )?base)/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^Nombre/).fill(name);
  await dialog.getByRole("radio", { name: "Interna", exact: true }).check();
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: /^Crear( la)?( base)?$/ }));
  await expect(page, `the new base «${name}» opens`).toHaveURL(BASE_URL, { timeout: 15_000 });
  const id = BASE_URL.exec(page.url())?.[1];
  if (!id) throw new Error(`No id for the base «${name}»`);
  return id;
}

/** The tabs of the agent editor, by their labels. */
export async function editorTabLabels(page: Page): Promise<string[]> {
  return page.getByRole("navigation", { name: "Secciones del agente" }).getByRole("link").allInnerTexts();
}

/** Acceso › «Personas concretas» with exactly these people (by name), saved ([INT-05]). */
export async function giveAccessTo(page: Page, agentId: string, names: readonly string[]): Promise<void> {
  await page.goto(agentAccessPath(agentId));
  await page.getByRole("radio", { name: "Personas concretas", exact: true }).check();
  const people = page.getByRole("group", { name: "Personas con acceso" });
  for (const box of await people.getByRole("checkbox").all()) if (await box.isChecked()) await box.uncheck();
  for (const name of names) await people.getByRole("checkbox", { name: new RegExp(`^${escapeRegExp(name)}`) }).check();
  await clickAndWaitForPost(page, page.getByRole("button", { name: "Guardar acceso", exact: true }));
  await expect(page.getByText("Acceso guardado.")).toBeVisible();
}

/** The card of an assistant in /asistentes. */
export function assistantCard(page: Page, name: string): Locator {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
}

export function assistantLog(page: Page): Locator {
  return page.getByRole("log");
}

export function questionBox(page: Page): Locator {
  return page.getByLabel("Tu pregunta", { exact: true });
}

export function sendQuestionButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Envia(r|ndo…)$/ });
}

/** Writes a question and waits for its answer to be shown. */
export async function ask(page: Page, text: string): Promise<void> {
  await questionBox(page).fill(text);
  await clickAndWaitForPost(page, sendQuestionButton(page));
  await expect(sendQuestionButton(page)).toHaveText("Enviar");
}

/** The person's conversations with the assistant that is open. */
export function myConversations(page: Page): Locator {
  return page.getByRole("navigation", { name: "Tus conversaciones" }).getByRole("listitem");
}
