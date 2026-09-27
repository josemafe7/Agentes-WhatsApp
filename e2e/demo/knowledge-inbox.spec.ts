// Fase 4 acceptance in the Bandeja: the knowledge fragments of a live reply are kept and «¿Por qué respondió esto?»
// shows them ([CON-20], [BAN-07]); a person's reply becomes a question and answer of a base with «Convertir en FAQ»,
// editable before it is saved ([CON-22]).
// Each test sets up its own base, web chat and visitor (a new browser on /widget-demo). The simulated OpenRouter answers
// from the «Buscar siempre» section of the prompt with the sentence of fragment [1] and «(Fuente: <título>)».
import { authStatePath } from "../support/app";
import { createWebchatChannel, setUpWebchat, widgetDemoPath } from "../support/channels";
import { untilWithQueue } from "../support/engine";
import { openConversationWith, replyAsPerson } from "../support/inbox";
import {
  basePath,
  createBaseWithFile,
  createKnowledgeBase,
  faqFields,
  fragmentItem,
  openConvertToFaq,
  openSources,
  saveFaqTo,
  useKnowledgeBases,
} from "../support/knowledge";
import { SALON_RULES, salonRulesMarkdown } from "../support/knowledge-files";
import { uniqueMessage, uniqueName, uniqueRef } from "../support/names";
import { expect, test } from "../support/test";
import { escapeRegExp } from "../support/ui";
import { openVisitor, sendVisitorMessage, visitorAiReplies } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

test.describe("with the OpenRouter key", () => {
  test("[CON-20][BAN-07] the fragments an agent used for a live reply are kept: in the Bandeja, «Ver fuentes» opens «¿Por qué respondió esto?» with them", async ({
    page,
    browser,
    request,
    openRouterKey,
  }, testInfo) => {
    test.setTimeout(240_000);
    expect(openRouterKey).toBeTruthy();
    const ref = uniqueRef(testInfo, "normas");
    const title = SALON_RULES.title(ref);
    const baseName = uniqueName(testInfo, "Base e2e fuentes");
    await createBaseWithFile(page, request, baseName, salonRulesMarkdown(ref), title);
    const setup = await setUpWebchat(page, testInfo, "Agente con fuentes");
    await useKnowledgeBases(page, setup.agentId, [baseName], "Buscar siempre");
    const demoPath = await widgetDemoPath(page, setup.channelId);

    const question = uniqueMessage(testInfo, SALON_RULES.question);
    const visitor = await openVisitor(browser, testInfo, demoPath);
    try {
      await sendVisitorMessage(visitor, question);
      const replies = visitorAiReplies(visitor, setup.agentName);
      await untilWithQueue(request, async () => (await replies.count()) > 0, "the agent answers with the knowledge");
      await expect(replies).toContainText(SALON_RULES.answer);
      await expect(replies).toContainText(`(Fuente: ${title})`);

      await openConversationWith(page, question);
      const panel = await openSources(page);
      const first = fragmentItem(panel, 1);
      await expect(first).toContainText(title);
      // Its place (the Markdown has headings, no pages), its base and its score.
      await expect(first).toContainText("Normas del salón >");
      await expect(first).toContainText(`Base «${baseName}»`);
      await expect(first).toContainText(/\d[,.]\d/);
      // Who may open Conocimiento goes on to the document.
      await expect(first.getByRole("link", { name: /documento/i })).toHaveAttribute("href", new RegExp(`^/conocimiento/[0-9a-f-]{36}/documentos/[0-9a-f-]{36}$`));
    } finally {
      await visitor.context.close();
    }
  });
});

test("[CON-22] «Convertir en FAQ» turns a person's reply into the customer's question and that answer, editable before it is saved in the chosen base", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const baseName = uniqueName(testInfo, "Base e2e FAQ");
  const baseId = await createKnowledgeBase(page, baseName);
  // A web chat without an agent: the visitor's message waits for a person ([CAN-03]).
  const channelId = await createWebchatChannel(page, uniqueName(testInfo, "Chat web FAQ"));
  const demoPath = await widgetDemoPath(page, channelId);

  const question = uniqueMessage(testInfo, "¿Tenéis aparcamiento para clientes?");
  const personReply = uniqueMessage(testInfo, "No tenemos, pero hay un aparcamiento público a 50 metros.");
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, question);
    await openConversationWith(page, question);
    await replyAsPerson(page, personReply);

    const dialog = await openConvertToFaq(page);
    const { question: questionField, answer: answerField } = faqFields(dialog);
    await expect(questionField).toHaveValue(new RegExp(escapeRegExp(question)));
    await expect(answerField).toHaveValue(personReply);
    const edited = `${personReply} Abre de 8:00 a 22:00.`;
    await answerField.fill(edited);
    await saveFaqTo(page, dialog, baseName);

    await page.goto(basePath(baseId, "faq"));
    const main = page.getByRole("main");
    await expect(main).toContainText(question);
    await expect(main).toContainText(edited);
  } finally {
    await visitor.context.close();
  }
});
