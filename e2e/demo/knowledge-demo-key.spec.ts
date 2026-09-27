// Fase 4 on the demo's base with the OpenRouter key (README «Conocimiento (fase 4)», steps 2, 4 and 6): once its
// fragments have their embeddings (the pending-embeddings job starts when the key is saved), a word that appears is
// still enough ([CON-16]: «basta con que aparezca alguna de las palabras»): «autobus» and «¿Cómo llego en autobús?» find
// page 2 of «Normas de citas y cómo llegar» in «Probar búsqueda», and an agent that uses the base answers the README's
// question from it, citing the document and the page. The simulated OpenRouter embeds texts as bags of words, so a
// one-word question is far in meaning from a long fragment: only the word match makes it relevant.
import type { Page } from "@playwright/test";
import { agentPath, createNamedAgent, replyDetails, sendTestMessage, testChatLog, uniqueAgentName } from "../support/agents";
import { authStatePath } from "../support/app";
import { untilWithQueue } from "../support/engine";
import {
  basePath,
  documentRows,
  enableKnowledgeTool,
  fragmentItem,
  listedBases,
  NOTHING_RELEVANT,
  pageMark,
  PROCESSING_TIMEOUT_MS,
  testSearch,
  TEXT_ONLY,
  textOnlyNotes,
  useKnowledgeBases,
} from "../support/knowledge";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

/** The demo's PDF (seed/knowledge) and the page that says how to get there by bus. */
const DIRECTIONS = { title: "Normas de citas y cómo llegar", page: 2 } as const;
const README_QUESTION = "¿Cómo llego en autobús?";

/** The seed's base «Información del negocio»: the first base on /conocimiento that no e2e spec created. */
async function demoBase(page: Page): Promise<{ id: string; name: string }> {
  const [base] = (await listedBases(page)).filter((candidate) => !/\be2e\b/i.test(candidate.name));
  expect(base, "the demo has a knowledge base ([ARR-12])").toBeTruthy();
  return base;
}

test.describe("with the OpenRouter key", () => {
  test("[CON-16][CON-17][CON-18][CON-21] once the demo's fragments have embeddings, «autobus» and «¿Cómo llego en autobús?» still find the bus page, and an agent answers the README's question citing it", async ({
    page,
    request,
    openRouterKey,
  }, testInfo) => {
    test.setTimeout(240_000);
    expect(openRouterKey).toBeTruthy();
    const base = await demoBase(page);

    await test.step("[CON-12] the pending embeddings of the demo are computed in the background", async () => {
      await untilWithQueue(
        request,
        async () => {
          await page.goto(basePath(base.id));
          const rows = await documentRows(page).count();
          return rows > 0 && (await documentRows(page).filter({ hasText: TEXT_ONLY }).count()) === 0;
        },
        "every demo document reaches «Listo» with its embeddings",
        PROCESSING_TIMEOUT_MS,
      );
    });

    for (const query of ["autobus", README_QUESTION]) {
      await test.step(`[CON-16][CON-17] «Probar búsqueda» with «${query}» finds page ${DIRECTIONS.page} by meaning and words`, async () => {
        const results = await testSearch(page, base.id, query);
        await expect(page.getByRole("main").getByText(NOTHING_RELEVANT)).toHaveCount(0);
        await expect(results.first()).toContainText(DIRECTIONS.title);
        await expect(results.first()).toContainText(pageMark(DIRECTIONS.page));
        expect(await textOnlyNotes(page), "with a key and embeddings the search is not text-only").toBe(0);
      });
    }

    await test.step("[CON-18][CON-19][PRU-02] an agent that uses the base answers «¿Cómo llego en autobús?» from that page, citing it", async () => {
      const agentId = await createNamedAgent(page, uniqueAgentName(testInfo, "Agente de cómo llegar"));
      await enableKnowledgeTool(page, agentId);
      await useKnowledgeBases(page, agentId, [base.name], "Automático");
      await page.goto(agentPath(agentId, "probar"));
      await sendTestMessage(page, README_QUESTION);
      const log = testChatLog(page);
      await expect(log).toContainText(`(Fuente: ${DIRECTIONS.title}, pág. ${DIRECTIONS.page})`);
      await expect(log).not.toContainText(/no lo sé/i);
      const details = replyDetails(page);
      await expect(details).not.toContainText("SIN_RESULTADOS");
      await expect(fragmentItem(details, 1)).toContainText(DIRECTIONS.title);
    });
  });
});
