// Fase 4 acceptance, the long document ([CON-23]): a 120-page PDF uploaded to a knowledge base goes through its steps
// in the background, every page is read and indexed, «Probar búsqueda» finds a fact of page 112 with its page, and an
// agent that uses the base answers that fact in «Probar» citing the document and the page.
// The PDF is made in code (e2e/support/knowledge-files.ts): the fact's words are on page 112 only. With the key, the
// simulated OpenRouter embeds texts as bags of words (texts that share words are close) and its model calls
// buscar_conocimiento and answers with the sentence of fragment [1] and «(Fuente: <título>, pág. N)».
// The queue runs through the cron address while the tests wait (e2e/support/engine.ts).
import { chatRequests, messageText } from "../support/ai";
import { agentPath, createNamedAgent, replyDetails, sendTestMessage, testChatLog, uniqueAgentName } from "../support/agents";
import { authStatePath } from "../support/app";
import {
  addKnowledgeFile,
  basePath,
  createKnowledgeBase,
  documentRows,
  DUPLICATE_FILE,
  embeddingsRequests,
  enableKnowledgeTool,
  fragmentItem,
  pageMark,
  testSearch,
  TEXT_ONLY,
  textOnlyNotes,
  uploadKnowledgeFile,
  useKnowledgeBases,
  waitForDocumentReady,
} from "../support/knowledge";
import { MANUAL, manualPdf } from "../support/knowledge-files";
import { uniqueName, uniqueRef } from "../support/names";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

/** Texts per embeddings request (64–128, src/server/knowledge/constants.ts). */
const MAX_EMBEDDING_BATCH = 128;
/** The search answer given to the model: ~3,500 tokens at most ([CON-19]), JSON-escaped. */
const MAX_TOOL_RESULT_CHARS = 16_000;
/** A list of numbers like an embedding's. */
const EMBEDDING_LIKE = /\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){15,}/;

test.describe("with the OpenRouter key", () => {
  test("[CON-04][CON-05][CON-06][CON-10][CON-11][CON-14][CON-16][CON-21] a 120-page PDF reaches «Listo» with every page indexed, a second copy is refused, and «Probar búsqueda» finds the fact with its page", async ({
    page,
    request,
    mock,
    openRouterKey,
  }, testInfo) => {
    test.setTimeout(240_000);
    expect(openRouterKey).toBeTruthy();
    const ref = uniqueRef(testInfo, "manual");
    const title = MANUAL.title(ref);
    const baseId = await createKnowledgeBase(page, uniqueName(testInfo, "Base e2e manual"));

    await test.step("[CON-04][CON-05][CON-06] the PDF is accepted and processed in the background until «Listo», with its 120 pages", async () => {
      await addKnowledgeFile(page, baseId, manualPdf(ref));
      const row = await waitForDocumentReady(page, request, baseId, title);
      expect(row, "pages (and fragments) of the whole PDF").toMatch(new RegExp(`\\b${MANUAL.pages}\\b`));
      // [CON-11] Its embeddings are done: not «Listo (solo texto)».
      expect(row).not.toMatch(TEXT_ONLY);
    });

    await test.step("[CON-10][CON-11] one fragment per page, embedded in batches of 1536 dimensions, privately, each with «Documento: título»", async () => {
      const requests = await embeddingsRequests(mock);
      const fragments = requests.flatMap((sent) => sent.input).filter((input) => input.startsWith(`Documento: ${title}`));
      expect(fragments.length).toBeGreaterThanOrEqual(MANUAL.pages);
      expect(requests.length, "more than one request: in batches").toBeGreaterThan(1);
      for (const sent of requests) {
        expect(sent.input.length).toBeLessThanOrEqual(MAX_EMBEDDING_BATCH);
        expect(sent.dimensions).toBe(1536);
        expect(sent.provider?.data_collection).toBe("deny");
      }
      expect(fragments.filter((input) => input.includes(MANUAL.answer)), "the fact is in one fragment").toHaveLength(1);
    });

    await test.step("[CON-14] the same file again is refused and not duplicated", async () => {
      const { dialog, accepted } = await uploadKnowledgeFile(page, baseId, manualPdf(ref));
      expect(accepted).toBe(false);
      await expect(dialog).toContainText(DUPLICATE_FILE);
      await page.goto(basePath(baseId));
      await expect(documentRows(page).filter({ hasText: title })).toHaveCount(1);
    });

    await test.step("[CON-21][CON-16] «Probar búsqueda» finds the fact's page first, with its score and source, by meaning and words and without the chat model", async () => {
      const embeddingsBefore = (await embeddingsRequests(mock)).length;
      const chatsBefore = (await chatRequests(mock)).length;
      const results = await testSearch(page, baseId, MANUAL.question);
      await expect(results.first()).toContainText(title);
      await expect(results.first()).toContainText(pageMark(MANUAL.factPage));
      await expect(results.first(), "its score").toContainText(/\d[,.]\d/);
      const count = await results.count();
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count, "the best 8 at most").toBeLessThanOrEqual(8);
      // By meaning too: the question itself was embedded; no chat model was asked.
      const queries = (await embeddingsRequests(mock)).slice(embeddingsBefore);
      expect(queries.some((sent) => sent.input.length === 1 && sent.input[0].includes("Índigo Nocturno"))).toBe(true);
      expect(await chatRequests(mock)).toHaveLength(chatsBefore);
      expect(await textOnlyNotes(page), "with a key the search is not text-only").toBe(0);
    });
  });

  test("[CON-23][AGE-07][HER-01][PRU-02][CON-19][CON-03] an agent that uses the base answers a fact of page 112 of the 120-page PDF in Probar, citing the document and the page", async ({
    page,
    request,
    mock,
    openRouterKey,
  }, testInfo) => {
    test.setTimeout(240_000);
    expect(openRouterKey).toBeTruthy();
    const ref = uniqueRef(testInfo, "manual");
    const title = MANUAL.title(ref);
    const baseName = uniqueName(testInfo, "Base e2e manual del agente");
    const baseId = await createKnowledgeBase(page, baseName);
    await addKnowledgeFile(page, baseId, manualPdf(ref));
    await waitForDocumentReady(page, request, baseId, title);

    const agentName = uniqueAgentName(testInfo, "Agente del manual");
    const agentId = await createNamedAgent(page, agentName);
    await test.step("[AGE-07][AGE-08][HER-01] the agent searches this base «Automático», with «Buscar en el conocimiento» on", async () => {
      await enableKnowledgeTool(page, agentId);
      await useKnowledgeBases(page, agentId, [baseName], "Automático");
    });

    await page.goto(agentPath(agentId, "probar"));
    await sendTestMessage(page, MANUAL.question);
    const log = testChatLog(page);

    await test.step("[CON-23] the reply gives the fact and cites the document and its page", async () => {
      await expect(log).toContainText(MANUAL.answer);
      await expect(log).toContainText(`(Fuente: ${title}, pág. ${MANUAL.factPage})`);
    });

    await test.step("[PRU-02] Probar shows the search with its data and result, and the fragments with score and source", async () => {
      const details = replyDetails(page);
      await expect(details).toContainText("Buscar en el conocimiento");
      await expect(details).toContainText("buscar_conocimiento");
      const first = fragmentItem(details, 1);
      await expect(first).toContainText(title);
      await expect(first).toContainText(pageMark(MANUAL.factPage));
      await expect(first, "the base it comes from").toContainText(`Base «${baseName}»`);
      await expect(first, "its score").toContainText(/\d[,.]\d/);
    });

    await test.step("[HER-01][CON-19][CON-03] the model got numbered fragments of this agent's base, with title and page, compact and without embeddings", async () => {
      const calls = (await chatRequests(mock)).filter((call) => messageText(call.body.messages[0]).includes(`Te llamas ${agentName}.`));
      expect(calls, "one call to search and one to answer").toHaveLength(2);
      expect(calls[0].body.tools?.map((tool) => tool.function?.name)).toContain("buscar_conocimiento");
      const toolResult = calls[1].body.messages.at(-1);
      expect(toolResult?.role).toBe("tool");
      const text = messageText(toolResult);
      // Fragment [1] is page 112 of this base's copy (any other base holding the manual has another title, [CON-03]).
      expect(text).toContain(`[1] ${title} · pág. ${MANUAL.factPage}`);
      expect(text.length).toBeLessThan(MAX_TOOL_RESULT_CHARS);
      expect(text).not.toMatch(EMBEDDING_LIKE);
    });
  });
});
