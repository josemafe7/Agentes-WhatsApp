// Fase 10 acceptance (docs/spec.md «Agentes internos»): the owner creates an internal agent with an internal base and
// a PDF and gives it to one person; that person asks in «Asistentes» and gets the answer with its document and page;
// someone without access neither sees it nor opens it by its address; the supervisor sees neither the internal agent
// nor the internal base; an agent for customers is not offered the internal base; an internal agent has no channels;
// what a person asks is only theirs; and deleting the agent warns that the team's conversations go with it.
// The simulated OpenRouter (e2e/mocks/routes/openrouter.mjs) calls buscar_conocimiento with the question and answers
// with the sentence of fragment [1] and «(Fuente: <título>, pág. N)». The document is the 120-page «Manual de
// procedimientos» (e2e/support/knowledge-files.ts), with a name of its own for this test: its fact is on page 112.
import { chatRequests, messageText } from "../support/ai";
import { agentCard, agentPath, AGENTS_PATH, createNamedAgent, deleteAgentFromList, instructionField, uniqueAgentName } from "../support/agents";
import { authStatePath, newPersonContext } from "../support/app";
import {
  ask,
  assistantCard,
  assistantLog,
  assistantPath,
  ASSISTANTS_PATH,
  createInternalAgent,
  createInternalBase,
  DEMO_INTERNAL_AGENT,
  DEMO_INTERNAL_BASE,
  editorTabLabels,
  giveAccessTo,
  myConversations,
  NOT_FOUND,
  questionBox,
  sendQuestionButton,
} from "../support/assistants";
import { addKnowledgeFile, agentBaseSwitch, agentKnowledgePath, basePath, KNOWLEDGE_PATH, pageMark, useKnowledgeBases, waitForDocumentReady } from "../support/knowledge";
import { MANUAL, manualPdf } from "../support/knowledge-files";
import { uniqueName, uniqueRef } from "../support/names";
import { clientIpFor, expect, test } from "../support/test";
import { mainMenu, NO_PERMISSION } from "../support/ui";
import { DEMO_USERS } from "../support/users";

test.describe("as the owner, with the OpenRouter key", () => {
  test.use({ storageState: authStatePath("owner") });

  test("[INT-01][INT-02][INT-03][INT-04][INT-05][INT-06][INT-07][INT-09][INT-10][INT-15] an internal agent with an internal base answers only who was given access, and its conversations are theirs alone", async ({
    page,
    request,
    browser,
    mock,
    openRouterKey,
  }, testInfo) => {
    test.setTimeout(240_000);
    expect(openRouterKey).toBeTruthy();
    const ref = uniqueRef(testInfo, "interno");
    const title = MANUAL.title(ref);
    const baseName = uniqueName(testInfo, "Base interna e2e");
    const agentName = uniqueAgentName(testInfo, "Asistente interno");
    // An agent that answers customers, of this test alone (other tests leave agents with the template's name).
    const customersAgentName = uniqueAgentName(testInfo, "Agente de clientes");
    let baseId = "";
    let agentId = "";

    await test.step("[INT-04] the owner creates an internal base and uploads a 120-page PDF to it", async () => {
      baseId = await createInternalBase(page, baseName);
      await expect(page.getByRole("main").getByText("Interna", { exact: true })).toBeVisible();
      await addKnowledgeFile(page, baseId, manualPdf(ref));
      const row = await waitForDocumentReady(page, request, baseId, title);
      expect(row, "the whole PDF was read").toMatch(new RegExp(`\\b${MANUAL.pages}\\b`));
    });

    await test.step("[INT-01][INT-02][INT-03] and an internal agent: with Acceso, without Herramientas, Traspaso or Canales", async () => {
      agentId = await createInternalAgent(page, agentName);
      expect(await editorTabLabels(page)).toEqual(["General", "Instrucciones", "Modelo", "Conocimiento", "Acceso", "Probar", "Versiones"]);
      await expect(page.getByRole("main").getByText("Interno", { exact: true })).toBeVisible();
      // It has no channels: the address of that tab does not exist for it.
      await page.goto(`${AGENTS_PATH}/${agentId}/canales`);
      await expect(page.getByText(NOT_FOUND)).toBeVisible();
      await page.goto(`${AGENTS_PATH}/${agentId}/herramientas`);
      await expect(page.getByText(NOT_FOUND)).toBeVisible();
      // Its instructions are written by hand: no draft made for an agent that attends customers, and no hand-off.
      await page.goto(agentPath(agentId, "instrucciones"));
      await expect(instructionField(page, "Rol")).toBeVisible();
      await expect(page.getByRole("button", { name: "Generar borrador con IA" })).toHaveCount(0);
      await expect(instructionField(page, "Cuándo pasar a una persona")).toHaveCount(0);
      // In Agentes it is listed apart, and never as an agent that answers on a channel.
      await page.goto(AGENTS_PATH);
      await expect(agentCard(page, agentName)).toContainText("Responde al equipo en «Asistentes».");
    });

    await test.step("[INT-04] it uses the internal base; an agent for customers is not even offered it", async () => {
      await useKnowledgeBases(page, agentId, [baseName], "Automático");
      const customersAgentId = await createNamedAgent(page, customersAgentName);
      await page.goto(agentKnowledgePath(customersAgentId));
      await expect(agentBaseSwitch(page, "Información del negocio")).toBeVisible();
      await expect(agentBaseSwitch(page, baseName)).toHaveCount(0);
      await expect(agentBaseSwitch(page, DEMO_INTERNAL_BASE)).toHaveCount(0);
    });

    await test.step("[INT-05] the owner gives it to one person: the demo agent", async () => {
      await giveAccessTo(page, agentId, [DEMO_USERS.agent.name]);
      await page.reload();
      await expect(page.getByRole("radio", { name: "Personas concretas", exact: true })).toBeChecked();
      await expect(page.getByRole("checkbox", { name: new RegExp(`^${DEMO_USERS.agent.name}`) })).toBeChecked();
      await expect(page.getByRole("checkbox", { name: new RegExp(`^${DEMO_USERS.supervisor.name}`) })).not.toBeChecked();
    });

    const agentContext = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:agent`), storageState: authStatePath("agent") });
    const asAgent = await agentContext.newPage();
    let conversationUrl = "";
    await test.step("[INT-06][INT-07] that person finds it in «Asistentes», asks and gets the answer with its document and its page", async () => {
      await asAgent.goto("/bandeja");
      await mainMenu(asAgent).getByRole("link", { name: "Asistentes", exact: true }).click();
      await expect(asAgent).toHaveURL(new RegExp(`${ASSISTANTS_PATH}$`));
      await expect(assistantCard(asAgent, agentName)).toBeVisible();
      await assistantCard(asAgent, agentName).getByRole("link", { name: agentName, exact: true }).click();
      await expect(asAgent).toHaveURL(new RegExp(`${assistantPath(agentId)}$`));

      await ask(asAgent, MANUAL.question);
      const log = assistantLog(asAgent);
      await expect(log).toContainText(MANUAL.question);
      await expect(log).toContainText(MANUAL.answer);
      await expect(log).toContainText(`(Fuente: ${title}, pág. ${MANUAL.factPage})`);
      await log.getByRole("button", { name: /^Ver la(s \d+)? fuentes?$/ }).click();
      // The first source is the page of the fact, past page 100 of the PDF, with the base it comes from.
      const firstSource = log.getByRole("list").last().getByRole("listitem").first();
      await expect(firstSource).toContainText(title);
      await expect(firstSource).toContainText(pageMark(MANUAL.factPage));
      await expect(firstSource).toContainText(baseName);

      // The model was told it is an internal agent and offered only the search of its knowledge.
      const calls = (await chatRequests(mock)).filter((call) => messageText(call.body.messages[0]).includes(`Te llamas ${agentName}.`));
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(messageText(calls[0].body.messages[0])).toContain("asistente interno");
      for (const call of calls) expect((call.body.tools ?? []).map((tool) => tool.function?.name)).toEqual(["buscar_conocimiento"]);
    });

    await test.step("[INT-10] the conversation is saved: it is in «Tus conversaciones» and still there after loading the page again", async () => {
      await expect(myConversations(asAgent)).toHaveCount(1);
      await expect(myConversations(asAgent).first()).toContainText(MANUAL.question);
      await expect(asAgent).toHaveURL(/\?c=[0-9a-f-]{36}$/);
      conversationUrl = asAgent.url();
      // «Nueva conversación» right after the first answer leaves an empty chat, and the saved one opens again.
      await asAgent.getByRole("link", { name: "Nueva conversación", exact: true }).click();
      await expect(asAgent).toHaveURL(new RegExp(`${assistantPath(agentId)}$`));
      await expect(assistantLog(asAgent)).not.toContainText(MANUAL.answer);
      await expect(myConversations(asAgent)).toHaveCount(1);
      await myConversations(asAgent).first().getByRole("link").click();
      await expect(asAgent).toHaveURL(conversationUrl);
      await expect(assistantLog(asAgent)).toContainText(MANUAL.answer);
      await asAgent.reload();
      await expect(assistantLog(asAgent)).toContainText(MANUAL.answer);
      await expect(myConversations(asAgent)).toHaveCount(1);
    });

    await test.step("[INT-05][INT-06][INT-15] the supervisor, who was not given it, neither sees it nor opens it; nor the internal agent or base in their screens", async () => {
      const supervisorContext = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:supervisor`), storageState: authStatePath("supervisor") });
      const asSupervisor = await supervisorContext.newPage();
      await asSupervisor.goto(ASSISTANTS_PATH);
      // The demo's own internal agent is for the whole team ([INT-14]); the new one is not theirs.
      await expect(assistantCard(asSupervisor, DEMO_INTERNAL_AGENT)).toBeVisible();
      await expect(assistantCard(asSupervisor, agentName)).toHaveCount(0);
      for (const address of [assistantPath(agentId), conversationUrl, `${AGENTS_PATH}/${agentId}`, `${AGENTS_PATH}/${agentId}/probar`, basePath(baseId)]) {
        await asSupervisor.goto(address);
        await expect(asSupervisor.getByText(NOT_FOUND), `${address} does not exist for the supervisor`).toBeVisible();
      }
      await asSupervisor.goto(AGENTS_PATH);
      await expect(agentCard(asSupervisor, customersAgentName)).toBeVisible();
      await expect(agentCard(asSupervisor, agentName)).toHaveCount(0);
      await expect(agentCard(asSupervisor, DEMO_INTERNAL_AGENT)).toHaveCount(0);
      await asSupervisor.goto(KNOWLEDGE_PATH);
      await expect(asSupervisor.getByRole("main").getByRole("link", { name: "Información del negocio", exact: true })).toBeVisible();
      await expect(asSupervisor.getByRole("main").getByRole("link", { name: baseName, exact: true })).toHaveCount(0);
      await expect(asSupervisor.getByRole("main").getByRole("link", { name: DEMO_INTERNAL_BASE, exact: true })).toHaveCount(0);
      await supervisorContext.close();
    });

    await test.step("[INT-09] the owner can use the agent but does not see what that person asked", async () => {
      await page.goto(assistantPath(agentId));
      await expect(questionBox(page)).toBeVisible();
      await expect(myConversations(page)).toHaveCount(0);
      await page.goto(conversationUrl);
      // Somebody else's conversation: a new one opens instead.
      await expect(page).toHaveURL(new RegExp(`${assistantPath(agentId)}$`));
      await expect(assistantLog(page)).not.toContainText(MANUAL.question);
    });

    await test.step("[INT-10] the person deletes their conversation", async () => {
      await asAgent.getByRole("button", { name: /^Borrar la conversación/ }).click();
      const confirm = asAgent.getByRole("alertdialog");
      await expect(confirm).toContainText("¿Borrar esta conversación?");
      await confirm.getByRole("button", { name: "Borrar", exact: true }).click();
      await expect(myConversations(asAgent)).toHaveCount(0);
      await expect(asAgent).toHaveURL(new RegExp(`${assistantPath(agentId)}$`));
      await asAgent.goto(conversationUrl);
      await expect(asAgent).toHaveURL(new RegExp(`${assistantPath(agentId)}$`));
      await expect(assistantLog(asAgent)).not.toContainText(MANUAL.answer);
    });
    await agentContext.close();

    await test.step("[INT-10] deleting the internal agent warns that the team's conversations go with it, and it leaves «Asistentes»", async () => {
      await page.goto(AGENTS_PATH);
      const confirm = await deleteAgentFromList(page, agentName);
      await expect(confirm).toContainText("todas las conversaciones que tu equipo ha tenido con él");
      await confirm.getByRole("button", { name: "Borrar agente", exact: true }).click();
      await expect(agentCard(page, agentName)).toHaveCount(0);
      await page.goto(ASSISTANTS_PATH);
      await expect(assistantCard(page, agentName)).toHaveCount(0);
      await page.goto(assistantPath(agentId));
      await expect(page.getByText(NOT_FOUND)).toBeVisible();
    });
  });
});

test.describe("without the OpenRouter key", () => {
  test.use({ storageState: authStatePath("agent") });

  test("[INT-11][INT-14] the demo's internal agent is there for the team, and without a key it says so and nothing can be sent", async ({ page }) => {
    await page.goto(ASSISTANTS_PATH);
    await assistantCard(page, DEMO_INTERNAL_AGENT).getByRole("link", { name: DEMO_INTERNAL_AGENT, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: DEMO_INTERNAL_AGENT })).toBeVisible();
    await expect(page.getByText(/sin ella el asistente no responde y no se puede enviar/)).toBeVisible();
    await expect(questionBox(page)).toBeDisabled();
    await expect(sendQuestionButton(page)).toBeDisabled();
    await expect(myConversations(page)).toHaveCount(0);
  });
});

test.describe("as the demo viewer", () => {
  test.use({ storageState: authStatePath("viewer") });

  test("[INT-05] «Solo lectura» has no «Asistentes»: not in the menu, and not by its address", async ({ page }) => {
    await page.goto("/bandeja");
    await expect(mainMenu(page).getByRole("link", { name: "Asistentes", exact: true })).toHaveCount(0);
    await page.goto(ASSISTANTS_PATH);
    await expect(page.getByText(NO_PERMISSION)).toBeVisible();
  });
});
