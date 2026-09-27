// Conocimiento as a person uses it ([CON-*], [AGE-07], [BAN-07], [CON-22]), in one place. Locators follow
// docs/pantallas.md «Conocimiento», «Editor del agente» and «Conversación», DESIGN.md and the screens themselves
// (src/app/(app)/conocimiento, src/app/(app)/agentes/[id]/conocimiento, src/app/(app)/bandeja/[id]/_sources), so a
// change of wording is fixed here and not in every spec:
//   /conocimiento                 one card per base, its name a link to /conocimiento/[id]; «Nueva base» opens «Nueva
//                                 base de conocimiento» with «Nombre» and «Crear base», which opens the new base; without
//                                 an OpenRouter key, the note «Sin clave, la búsqueda va solo por texto.».
//   /conocimiento/[id]            Documentos: «Añadir contenido» opens a dialog whose «Archivos» tab has a file input and
//                                 «Subir archivo»; each file then shows its own result in the dialog, which stays open
//                                 («Este archivo ya está en la base.» for the same file twice, [CON-14]). The table has one
//                                 row per document: its title (a link to the document), the file name, type, state («En
//                                 cola», «Extrayendo», «Troceando», «Embeddings», «Listo», «Listo (solo texto)» or «Error»
//                                 with the reason), pages, fragments and date. The page refreshes itself while processing.
//   /conocimiento/[id]/probar     «Pregunta o palabras a buscar» and «Buscar»; the region «Resultados de «…»» with the
//                                 numbered fragments («[1] Título · Sección · pág. 3», scores, text), «Nada relevante», and
//                                 when it searched only by words, a note that says so («… solo por palabras …»).
//   /conocimiento/[id]/faq        «Preguntas de esta base»: each question with its answer.
//   /agentes/[id]/conocimiento    one switch per base, named after it (saved on the spot), and «Cuándo busca en el
//                                 conocimiento»: the radios «Automático» and «Buscar siempre», saved with the editor's save
//                                 bar («Cambios sin guardar · Guardar cambios»).
//   /agentes/[id]/herramientas    the switch «Buscar en el conocimiento» ([HER-01]).
//   /agentes/[id]/probar          «Detalles de la respuesta» › «Fragmentos de conocimiento»: «Fragmento N: <título>», its
//                                 section and «pág. N», its score and «Base «<nombre>»».
//   /bandeja/[id]                 an AI reply with sources has «Ver fuentes», which opens the panel «¿Por qué respondió
//                                 esto?» with «Fragmento N: <título>», «<sección> · página N · puntuación X», «Base «…»» and
//                                 «Abrir el documento»; a person's reply has «Convertir en FAQ», which opens «Convertir en
//                                 pregunta frecuente» with «Base de conocimiento», «Pregunta», «Respuesta» and «Guardar FAQ».
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { AGENTS_PATH, expectSaved, saveEditor, unsavedChangesBar } from "./agents";
import { untilWithQueue } from "./engine";
import { chooseOption } from "./forms";
import { conversationLog } from "./inbox";
import type { UploadFile } from "./knowledge-files";
import type { MockClient } from "./mock-client";
import { clickAndWaitForPost, OPENROUTER_BANNER } from "./ui";

export const KNOWLEDGE_PATH = "/conocimiento";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BASE_URL = new RegExp(`/conocimiento/(${UUID})(?:[/?#]|$)`);
const BASE_HREF = new RegExp(`^/conocimiento/(${UUID})/?$`);

export type BaseTab = "documentos" | "faq" | "probar" | "ajustes";

export function basePath(baseId: string, tab: BaseTab = "documentos"): string {
  return tab === "documentos" ? `${KNOWLEDGE_PATH}/${baseId}` : `${KNOWLEDGE_PATH}/${baseId}/${tab}`;
}

/** Enough for a document to go through its steps: extraction, chunking, summary and embeddings (queue run by hand). */
export const PROCESSING_TIMEOUT_MS = 90_000;

/** The document states of [CON-05] as the table shows them. */
export const DOCUMENT_STATES = {
  queued: "En cola",
  extracting: "Extrayendo",
  chunking: "Troceando",
  embedding: "Embeddings",
  ready: "Listo",
  error: "Error",
} as const;
/** «Listo (solo texto)»: processed, its embeddings wait for a key ([CON-12]). */
export const TEXT_ONLY = /solo texto/i;
/** What Conocimiento and «Probar búsqueda» say when the search went by words only ([ARR-14]). */
export const TEXT_ONLY_SEARCH = /solo por (texto|palabras)/i;
export const DUPLICATE_FILE = "Este archivo ya está en la base";
export const NOTHING_RELEVANT = "Nada relevante";

/** «pág. 112» or «página 112» (the page of a fragment). */
export function pageMark(page: number): RegExp {
  return new RegExp(`p[áa]g(?:\\.|ina)\\s*${page}(?!\\d)`, "i");
}

// ─── Bases ──────────────────────────────────────────────────────────────────────────────────────────────

/** The bases listed on /conocimiento: name and id. */
export async function listedBases(page: Page): Promise<{ id: string; name: string }[]> {
  await page.goto(KNOWLEDGE_PATH);
  await expect(page.getByRole("heading", { name: "Conocimiento", exact: true }).first()).toBeVisible();
  const links = await page
    .getByRole("main")
    .locator('a[href^="/conocimiento/"]')
    .evaluateAll((anchors) => anchors.map((anchor) => ({ href: anchor.getAttribute("href") ?? "", name: (anchor.textContent ?? "").trim() })));
  const bases: { id: string; name: string }[] = [];
  for (const { href, name } of links) {
    const id = BASE_HREF.exec(href)?.[1];
    if (id && name && !bases.some((base) => base.id === id)) bases.push({ id, name });
  }
  return bases;
}

/** «Nueva base» with a name; returns its id (the page is left on the new base). */
export async function createKnowledgeBase(page: Page, name: string): Promise<string> {
  await page.goto(KNOWLEDGE_PATH);
  await page
    .getByRole("main")
    .getByRole("button", { name: /^(Nueva base|Crear (una )?base)/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^Nombre/).fill(name);
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: /^Crear( la)?( base)?$/ }));
  await expect(page, `the new base «${name}» opens`).toHaveURL(BASE_URL, { timeout: 15_000 });
  const id = BASE_URL.exec(page.url())?.[1];
  if (!id) throw new Error(`No id for the base «${name}»`);
  return id;
}

// ─── Documents ([CON-04], [CON-05], [CON-14]) ───────────────────────────────────────────────────────────

export type UploadOutcome = {
  /** The «Añadir contenido» dialog, still open, with the file's result. */
  dialog: Locator;
  /** The app took the file (the upload route answered 2xx). */
  accepted: boolean;
};

/** «Añadir contenido» › «Archivos»: chooses `file` and sends it. The dialog is left open with its result. */
export async function uploadKnowledgeFile(page: Page, baseId: string, file: UploadFile): Promise<UploadOutcome> {
  await page.goto(basePath(baseId));
  await page
    .getByRole("main")
    .getByRole("button", { name: /^Añadir contenido/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: /^Añadir contenido/ });
  await expect(dialog).toBeVisible();
  const filesTab = dialog.getByRole("tab", { name: /^Archivos?$/ });
  if (await filesTab.isVisible()) await filesTab.click();
  await dialog.locator('input[type="file"]').first().setInputFiles(file);
  const submit = dialog.getByRole("button", { name: /^Subir/ });
  await expect(submit).toBeEnabled();
  const [response] = await Promise.all([page.waitForResponse((candidate) => candidate.request().method() === "POST"), submit.click()]);
  // The file's own result line (a success message or the reason it was refused).
  await expect(dialog.getByRole("listitem").filter({ hasText: file.name }).first()).not.toContainText("Subiendo…");
  return { dialog, accepted: response.ok() };
}

/** Uploads a file the app must accept and closes the dialog. */
export async function addKnowledgeFile(page: Page, baseId: string, file: UploadFile): Promise<void> {
  const { dialog, accepted } = await uploadKnowledgeFile(page, baseId, file);
  expect(accepted, `«${file.name}» is accepted`).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

/** The row of a document in the base's table (titles in the tests are unique). */
export function documentRow(page: Page, title: string): Locator {
  return page.getByRole("main").getByRole("row").filter({ hasText: title }).first();
}

/** Every document row of the base's table (the header row left out). */
export function documentRows(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
}

const READY = new RegExp(`\\b${DOCUMENT_STATES.ready}\\b`);
const FAILED = new RegExp(`\\b${DOCUMENT_STATES.error}\\b`);

/**
 * Runs the background queue until the document is «Listo» (or «Listo (solo texto)») and returns what its row says.
 * Stops at once when it ends in «Error», with the reason.
 */
export async function waitForDocumentReady(page: Page, request: APIRequestContext, baseId: string, title: string): Promise<string> {
  const row = documentRow(page, title);
  let text = "";
  await untilWithQueue(
    request,
    async () => {
      await page.goto(basePath(baseId));
      text = (await row.isVisible()) ? (await row.innerText()).replace(/\s+/g, " ") : "(no row)";
      if (FAILED.test(text)) throw new Error(`«${title}» ended in error: ${text}`);
      return READY.test(text);
    },
    `«${title}» reaches «${DOCUMENT_STATES.ready}»`,
    PROCESSING_TIMEOUT_MS,
  );
  return text;
}

/** A new base with one uploaded file, processed; returns the base id (the page is left on its documents). */
export async function createBaseWithFile(page: Page, request: APIRequestContext, baseName: string, file: UploadFile, title: string): Promise<string> {
  const baseId = await createKnowledgeBase(page, baseName);
  await addKnowledgeFile(page, baseId, file);
  await waitForDocumentReady(page, request, baseId, title);
  return baseId;
}

// ─── Probar búsqueda ([CON-16], [CON-21]) ───────────────────────────────────────────────────────────────

/** The numbered fragments «Probar búsqueda» found. */
export function searchResults(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("region", { name: /^Resultados/ })
    .getByRole("listitem");
}

/** Searches the base from «Probar búsqueda» (no chat model involved) and waits for the results or «Nada relevante». */
export async function testSearch(page: Page, baseId: string, query: string): Promise<Locator> {
  await page.goto(basePath(baseId, "probar"));
  const main = page.getByRole("main");
  await main.getByRole("textbox", { name: /pregunta|busca|consulta/i }).first().fill(query);
  await clickAndWaitForPost(page, main.getByRole("button", { name: /^Buscar$/ }));
  const region = main.getByRole("region", { name: /^Resultados/ });
  await expect(region.getByRole("listitem").first().or(region.getByText(NOTHING_RELEVANT)).first(), "«Probar búsqueda» answers").toBeVisible();
  return searchResults(page);
}

/** Notes on screen that the search goes by words only, the global «Añade tu clave de OpenRouter» notice left out. */
export async function textOnlyNotes(page: Page): Promise<number> {
  return page
    .getByRole("main")
    .getByText(TEXT_ONLY_SEARCH)
    .evaluateAll(
      (nodes, banner) => nodes.filter((node) => !(node.closest('[role="note"]')?.textContent ?? "").includes(banner)).length,
      OPENROUTER_BANNER,
    );
}

// ─── The agent's Conocimiento, Herramientas and Probar tabs ([AGE-07], [AGE-08], [HER-01], [PRU-02]) ─────

export type KnowledgeModeLabel = "Automático" | "Buscar siempre";

export function agentKnowledgePath(agentId: string): string {
  return `${AGENTS_PATH}/${agentId}/conocimiento`;
}

/** The switch of a base in the agent's Conocimiento tab. */
export function agentBaseSwitch(page: Page, baseName: string): Locator {
  return page.getByRole("main").getByRole("switch", { name: baseName, exact: true });
}

/** The agent searches `baseNames` ([CON-03]) in `mode`; checked again after a reload (it is saved). */
export async function useKnowledgeBases(page: Page, agentId: string, baseNames: readonly string[], mode: KnowledgeModeLabel): Promise<void> {
  await page.goto(agentKnowledgePath(agentId));
  for (const baseName of baseNames) {
    const toggle = agentBaseSwitch(page, baseName);
    await expect(toggle, `the base «${baseName}» can be chosen`).toBeEnabled();
    if (!(await toggle.isChecked())) await clickAndWaitForPost(page, toggle);
    await expect(toggle).toBeChecked();
  }
  const radio = page.getByRole("main").getByRole("radio", { name: mode, exact: true });
  if (!(await radio.isChecked())) {
    await radio.click();
    await saveEditor(page);
    await expectSaved(page);
  }
  await expect(radio).toBeChecked();

  await page.reload();
  for (const baseName of baseNames) await expect(agentBaseSwitch(page, baseName)).toBeChecked();
  await expect(page.getByRole("main").getByRole("radio", { name: mode, exact: true })).toBeChecked();
}

/** Herramientas › «Buscar en el conocimiento» switched on and saved. */
export async function enableKnowledgeTool(page: Page, agentId: string): Promise<void> {
  await page.goto(`${AGENTS_PATH}/${agentId}/herramientas`);
  const toggle = page.getByRole("switch", { name: "Buscar en el conocimiento" });
  await expect(toggle).toBeEnabled();
  if (!(await toggle.isChecked())) {
    await toggle.click();
    await expect(unsavedChangesBar(page)).toBeVisible();
    await saveEditor(page);
    await expectSaved(page);
  }
  await page.reload();
  await expect(page.getByRole("switch", { name: "Buscar en el conocimiento" })).toBeChecked();
}

/** Fragment `rank` of a list of fragments («Fragmento 1: <título>»: Probar's details and the Bandeja's panel). */
export function fragmentItem(scope: Locator, rank: number): Locator {
  return scope.getByRole("listitem").filter({ hasText: new RegExp(`Fragmento ${rank}:`) });
}

// ─── Bandeja ([BAN-07], [CON-20], [CON-22]) ─────────────────────────────────────────────────────────────

export const SOURCES_PANEL = "¿Por qué respondió esto?";

/** «Ver fuentes» of the AI replies of the open conversation. */
export function viewSourcesButtons(page: Page): Locator {
  return conversationLog(page).getByRole("button", { name: /^Ver fuentes/ });
}

/** Opens «¿Por qué respondió esto?» from the only AI reply with sources. */
export async function openSources(page: Page): Promise<Locator> {
  const button = viewSourcesButtons(page);
  await expect(button).toHaveCount(1);
  await button.click();
  const panel = page.getByRole("dialog", { name: SOURCES_PANEL });
  await expect(panel).toBeVisible();
  return panel;
}

/** «Convertir en FAQ» of the only person's reply of the open conversation; returns its dialog. */
export async function openConvertToFaq(page: Page): Promise<Locator> {
  const button = conversationLog(page).getByRole("button", { name: /^Convertir en FAQ/ });
  await expect(button, "one person's reply can be turned into a FAQ").toHaveCount(1);
  await button.click();
  const dialog = page.getByRole("dialog", { name: /FAQ|pregunta frecuente/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The question and answer fields of the «Convertir en FAQ» dialog (filled from the conversation). */
export function faqFields(dialog: Locator): { question: Locator; answer: Locator } {
  return { question: dialog.getByLabel("Pregunta", { exact: true }), answer: dialog.getByLabel("Respuesta", { exact: true }) };
}

/** Chooses the base in the «Convertir en FAQ» dialog and saves it. */
export async function saveFaqTo(page: Page, dialog: Locator, baseName: string): Promise<void> {
  await chooseOption(page, dialog.getByRole("combobox", { name: /^Base/ }), baseName);
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: /^Guardar/ }));
  await expect(dialog).toHaveCount(0);
}

// ─── What the simulated OpenRouter received ([CON-11], [CON-16], [ARR-14]) ──────────────────────────────

export const EMBEDDINGS_PATH = "/api/v1/embeddings";

export type EmbeddingsRequestSent = { input: string[]; dimensions?: number; model?: string; provider?: Record<string, unknown> };

/** The POST /embeddings the app sent since the mock was last reset (oldest first). */
export async function embeddingsRequests(mock: MockClient): Promise<EmbeddingsRequestSent[]> {
  const requests = await mock.requests({ service: "openrouter", method: "POST", path: EMBEDDINGS_PATH });
  return requests.map(({ body }) => {
    const value = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const input = Array.isArray(value.input) ? value.input.map(String) : [String(value.input ?? "")];
    return {
      input,
      dimensions: typeof value.dimensions === "number" ? value.dimensions : undefined,
      model: typeof value.model === "string" ? value.model : undefined,
      provider: typeof value.provider === "object" && value.provider !== null ? (value.provider as Record<string, unknown>) : undefined,
    };
  });
}
