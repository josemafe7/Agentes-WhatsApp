// Fase 4 acceptance, what the agent does not know ([CON-18]): with «Buscar siempre» the search runs before the model
// and, when nothing in the agent's bases is relevant, the model gets SIN_RESULTADOS and the agent says it does not
// know and offers a person; a question the base does answer gets the fact and its source.
// The base holds «Normas del salón» (e2e/support/knowledge-files.ts), which has none of the words of the unknown
// question. The simulated OpenRouter answers from the «# Conocimiento encontrado para este mensaje» section of the
// prompt: the sentence of fragment [1] with «(Fuente: …)», or «no lo sé» and a person when it says SIN_RESULTADOS.
import { chatRequests, messageText } from "../support/ai";
import { agentPath, createNamedAgent, replyDetails, sendTestMessage, testChatLog, uniqueAgentName } from "../support/agents";
import { authStatePath } from "../support/app";
import { createBaseWithFile, useKnowledgeBases } from "../support/knowledge";
import { SALON_RULES, salonRulesMarkdown } from "../support/knowledge-files";
import { uniqueName, uniqueRef } from "../support/names";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

/** The section «Buscar siempre» adds to the prompt (src/server/knowledge/agent-knowledge.ts). */
const PREFETCH_HEADING = "# Conocimiento encontrado para este mensaje";
const NO_RESULTS = "SIN_RESULTADOS";

test.describe("with the OpenRouter key", () => {
  test("[CON-18][AGE-07][MOT-05] with «Buscar siempre», a question that is not in the agent's bases gets «no lo sé» and the offer of a person; one that is gets the fact and its source", async ({
    page,
    request,
    mock,
    openRouterKey,
  }, testInfo) => {
    test.setTimeout(180_000);
    expect(openRouterKey).toBeTruthy();
    const ref = uniqueRef(testInfo, "normas");
    const title = SALON_RULES.title(ref);
    const baseName = uniqueName(testInfo, "Base e2e normas");
    await createBaseWithFile(page, request, baseName, salonRulesMarkdown(ref), title);

    const agentName = uniqueAgentName(testInfo, "Agente de normas");
    const agentId = await createNamedAgent(page, agentName);
    await useKnowledgeBases(page, agentId, [baseName], "Buscar siempre");
    await page.goto(agentPath(agentId, "probar"));
    const log = testChatLog(page);
    const agentCalls = async () => (await chatRequests(mock)).filter((call) => messageText(call.body.messages[0]).includes(`Te llamas ${agentName}.`));

    await test.step("[CON-18][MOT-05] nothing relevant: the agent says it does not know and offers a person, without a source", async () => {
      await sendTestMessage(page, SALON_RULES.unknownQuestion);
      await expect(log).toContainText(`Me has escrito: «${SALON_RULES.unknownQuestion}»`);
      await expect(log).toContainText(/no lo sé/i);
      await expect(log).toContainText(/persona del equipo/);
      await expect(log).not.toContainText("(Fuente:");
      const details = replyDetails(page);
      await expect(details).toContainText("buscar_conocimiento");
      await expect(details).toContainText(NO_RESULTS);
      await expect(details).toContainText("No ha usado fragmentos de conocimiento.");
    });

    await test.step("[AGE-07] the search ran before the model: its SIN_RESULTADOS was in the prompt, in one call", async () => {
      const calls = await agentCalls();
      expect(calls).toHaveLength(1);
      const prompt = messageText(calls[0].body.messages[0]);
      expect(prompt).toContain(PREFETCH_HEADING);
      expect(prompt.slice(prompt.indexOf(PREFETCH_HEADING))).toContain(NO_RESULTS);
    });

    await test.step("[AGE-07][CON-19] a question the base answers: the fact, with the document as its source", async () => {
      await sendTestMessage(page, SALON_RULES.question);
      await expect(log).toContainText(SALON_RULES.answer);
      await expect(log).toContainText(`(Fuente: ${title})`);
      await expect(replyDetails(page)).toContainText(title);
      const calls = await agentCalls();
      expect(calls).toHaveLength(2);
      const prompt = messageText(calls[1].body.messages[0]);
      expect(prompt.slice(prompt.indexOf(PREFETCH_HEADING))).toContain(`[1] ${title}`);
    });
  });
});
