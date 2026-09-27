// Fase 4 acceptance on the demo as it is loaded, without an OpenRouter key ([ARR-14]): the demo's knowledge base is
// searched by words — «Probar búsqueda» finds its fragments, says it searched only by text and nothing reaches
// OpenRouter — and the demo's AI answers show the fragments they used in «¿Por qué respondió esto?» ([CON-20]).
// The demo server runs without a key (tests that need one save it and remove it). The demo bases are the ones the
// seed loads (seed/steps/knowledge.ts); the bases the e2e specs create are all called «… e2e …».
import type { Page } from "@playwright/test";
import { authStatePath } from "../support/app";
import { openConversationWith } from "../support/inbox";
import {
  basePath,
  embeddingsRequests,
  fragmentItem,
  KNOWLEDGE_PATH,
  listedBases,
  SOURCES_PANEL,
  testSearch,
  textOnlyNotes,
  viewSourcesButtons,
} from "../support/knowledge";
import { expect, test } from "../support/test";
import { OPENROUTER_BANNER } from "../support/ui";

test.use({ storageState: authStatePath("owner") });

/** A customer message of the demo's web chat conversation «preguntas», whose AI answers carry their sources. */
const DEMO_SOURCED_QUESTION = "¿Y dónde estáis?";

/** The seed's bases: every base on /conocimiento that no e2e spec created. */
async function demoBases(page: Page): Promise<{ id: string; name: string }[]> {
  const bases = (await listedBases(page)).filter((base) => !/\be2e\b/i.test(base.name));
  expect(bases.length, "the demo has a knowledge base ([ARR-12])").toBeGreaterThan(0);
  return bases;
}

/** Titles of the base's documents: each one links to its page (/conocimiento/[id]/documentos/[docId]). */
async function documentTitles(page: Page, baseId: string): Promise<string[]> {
  await page.goto(basePath(baseId));
  const titles = await page
    .getByRole("main")
    .locator(`a[href*="/conocimiento/${baseId}/documentos/"]`)
    .allInnerTexts();
  return titles.map((title) => title.trim()).filter(Boolean);
}

/** Lower case without accents: how a customer may type it ([CON-17]). */
function asTyped(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

test("[ARR-14][CON-12][CON-17][CON-21] without an OpenRouter key the demo base is searched by words: «Probar búsqueda» finds its fragments, says it searched only by text, and nothing reaches OpenRouter", async ({
  page,
  mock,
}) => {
  await page.goto(KNOWLEDGE_PATH);
  await expect(page.locator('[role="note"]').filter({ hasText: OPENROUTER_BANNER }), "the demo runs without a key").toBeVisible();
  await expect.poll(() => textOnlyNotes(page), { message: "Conocimiento says the search goes by text only" }).toBeGreaterThan(0);

  const [demo] = await demoBases(page);
  const [title] = await documentTitles(page, demo.id);
  expect(title, `«${demo.name}» shows its documents`).toBeTruthy();

  // The title as someone would type it: lower case and without accents ([CON-17]).
  const results = await testSearch(page, demo.id, asTyped(title));
  await expect(results.filter({ hasText: title }).first(), "a fragment of that document is found by its words").toBeVisible();
  await expect.poll(() => textOnlyNotes(page), { message: "«Probar búsqueda» says it searched only by text" }).toBeGreaterThan(0);

  expect(await embeddingsRequests(mock), "no embedding is asked without a key").toHaveLength(0);
  expect(await mock.requests({ service: "openrouter", method: "POST" }), "nothing reaches OpenRouter").toHaveLength(0);
});

test("[CON-20][BAN-07] in a demo conversation, «Ver fuentes» opens «¿Por qué respondió esto?» with the demo base's fragments the AI used", async ({ page }) => {
  await openConversationWith(page, DEMO_SOURCED_QUESTION);
  const sources = viewSourcesButtons(page);
  await expect(sources.first(), "a demo AI answer has its sources").toBeVisible();
  await sources.first().click();

  const panel = page.getByRole("dialog", { name: SOURCES_PANEL });
  await expect(panel).toBeVisible();
  const first = fragmentItem(panel, 1);
  await expect(first).toBeVisible();
  await expect(first, "the base it comes from").toContainText(/Base «[^»]+»/);
  await expect(first, "its score").toContainText(/puntuación \d[,.]?\d*/);
  await expect(first.getByRole("link", { name: /documento/i })).toHaveAttribute("href", /^\/conocimiento\/[0-9a-f-]{36}\/documentos\/[0-9a-f-]{36}$/);
});
