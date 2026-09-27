// Fase 2 acceptance, the people's side: when a person answers from the Bandeja the AI pauses ([BAN-10], [BAN-11]); when
// the visitor asks for a person the agent hands the conversation over and the right people are told ([TRA-*]). Each test
// sets up its own agent and web chat; visitors are new browsers on /widget-demo. The simulated OpenRouter answers
// «Soy <agente>…» and calls transferir_a_humano when the last customer message asks for «una persona».
import { HANDOFF_ARGUMENTS } from "../support/ai";
import { agentPath, expectSaved, saveEditor } from "../support/agents";
import { authStatePath, newPersonContext } from "../support/app";
import { setUpWebchat, widgetDemoPath } from "../support/channels";
import { chatRequestsFor, holdsFor, untilWithQueue } from "../support/engine";
import {
  aiPausedNotice,
  anyOf,
  CONVERSATION_URL,
  customerMessage,
  expectHandoffNotice,
  expectNoHandoffNotice,
  openConversationWith,
  pendingHumanState,
  replyAsPerson,
} from "../support/inbox";
import { uniqueMessage } from "../support/names";
import { clientIpFor, expect, test } from "../support/test";
import { escapeRegExp } from "../support/ui";
import { DEMO_USERS } from "../support/users";
import { openVisitor, sendVisitorMessage, visitorAiReplies, visitorAnyAiReply } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

test("[BAN-11][BAN-10][BAN-03][MOT-03][WEB-06] a person answers from the Bandeja: the AI pauses («IA en pausa hasta…») and the visitor's next message gets no AI reply", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(150_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Agente con pausa");
  const demoPath = await widgetDemoPath(page, setup.channelId);
  const first = uniqueMessage(testInfo, "Hola, ¿hacéis mechas?");
  const personReply = uniqueMessage(testInfo, "Hola, soy Elena, del equipo. Sí, las hacemos: ¿qué día te viene bien?");
  const second = uniqueMessage(testInfo, "El jueves por la tarde");
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, first);
    const aiReplies = visitorAiReplies(visitor, setup.agentName);
    await untilWithQueue(request, async () => (await aiReplies.count()) === 1, "the agent answers the first message");

    const conversationId = await openConversationWith(page, first);
    await test.step("[BAN-11] the owner writes to the visitor and the AI of the conversation pauses", async () => {
      await replyAsPerson(page, personReply);
      await expect(aiPausedNotice(page)).toBeVisible();
      // [WEB-06] The person's message reaches the visitor without reloading.
      await expect(visitor.panel.getByText(personReply, { exact: true })).toBeVisible({ timeout: 20_000 });
    });

    await test.step("[BAN-03][MOT-03] the visitor's next message shows in the open conversation, and the paused AI stays quiet", async () => {
      const callsBefore = (await chatRequestsFor(mock, conversationId)).length;
      expect(callsBefore).toBe(1);
      await sendVisitorMessage(visitor, second);
      // New messages appear without reloading (within 5 s of polling).
      await expect(customerMessage(page, second)).toBeVisible();
      await expect(page).toHaveURL(CONVERSATION_URL);
      await holdsFor(
        request,
        async () => [(await chatRequestsFor(mock, conversationId)).length, await visitorAnyAiReply(visitor).count()],
        [callsBefore, 1],
        "no AI call and no AI reply while the conversation is paused",
      );
      await expect(aiPausedNotice(page)).toBeVisible();
    });
  } finally {
    await visitor.context.close();
  }
});

test("[TRA-01][TRA-02][TRA-03][TRA-05][TRA-07][HER-08] the visitor asks for a person: the agent calls transferir_a_humano, the conversation is «Pendiente de humano», the visitor gets the agent's hand-off message and only whom the agent says is told", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(210_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Agente que traspasa");
  const inHours = uniqueMessage(testInfo, "Te paso con el equipo ahora mismo.");
  const offHours = uniqueMessage(testInfo, "Estamos cerrados; el equipo te contestará al abrir.");

  await test.step("[AGE-09][TRA-05] Traspaso: the agent's own messages, and «A quién avisar» is only the supervisor", async () => {
    await page.goto(agentPath(setup.agentId, "traspaso"));
    await page.getByLabel(/dentro de horario/i).fill(inHours);
    await page.getByLabel(/fuera de horario/i).fill(offHours);
    await page.getByRole("checkbox", { name: new RegExp(`^${escapeRegExp(DEMO_USERS.supervisor.name)}`) }).check();
    await saveEditor(page);
    await expectSaved(page);
  });

  const demoPath = await widgetDemoPath(page, setup.channelId);
  // «una persona» makes the simulated model call the tool; no keyword of the template matches it (not «hablar con…»).
  const ask = uniqueMessage(testInfo, "Quiero que me atienda una persona, por favor");
  const after = uniqueMessage(testInfo, "¿Sigue ahí alguien?");
  const visitor = await openVisitor(browser, testInfo, demoPath);
  const supervisor = await newPersonContext(browser, testInfo, {
    clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:supervisor`),
    storageState: authStatePath("supervisor"),
  });
  const viewer = await newPersonContext(browser, testInfo, {
    clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:viewer`),
    storageState: authStatePath("viewer"),
  });
  try {
    await sendVisitorMessage(visitor, ask);
    // [TRA-03] The visitor gets the agent's hand-off message for the current time, never a text of the model.
    const handoffMessage = visitor.messages.getByText(anyOf(inHours, offHours));
    await untilWithQueue(request, async () => (await handoffMessage.count()) > 0, "the agent's hand-off message reaches the visitor");
    await expect(visitorAnyAiReply(visitor)).toHaveCount(0);

    const conversationId = await openConversationWith(page, ask);
    await test.step("[TRA-02][TRA-07][HER-08] the conversation waits for a person, with the reason and summary of the hand-off", async () => {
      await expect(pendingHumanState(page)).toBeVisible();
      await expect(page.getByRole("main")).toContainText(HANDOFF_ARGUMENTS.motivo);
      await expect(page.getByRole("main")).toContainText(HANDOFF_ARGUMENTS.resumen);
      const calls = await chatRequestsFor(mock, conversationId);
      expect(calls.length, "the model was asked").toBeGreaterThan(0);
      expect(calls[0].body.tools?.map((tool) => tool.function?.name)).toContain("transferir_a_humano");
    });

    await test.step("[TRA-05][PWA-06] the supervisor chosen in the agent gets the notice in the bell, and it opens the conversation", async () => {
      const supervisorPage = await supervisor.newPage();
      const notice = await expectHandoffNotice(supervisorPage, conversationId);
      await notice.click();
      await expect(supervisorPage).toHaveURL(new RegExp(`/bandeja/${conversationId}(?:[/?#]|$)`));
      await expect(pendingHumanState(supervisorPage)).toBeVisible();
    });

    await test.step("[TRA-05] people the agent did not choose get no hand-off notice: the owner, and never Solo lectura", async () => {
      await expectNoHandoffNotice(page, conversationId);
      await expectNoHandoffNotice(await viewer.newPage(), conversationId);
    });

    await test.step("[TRA-02] the AI no longer answers in the conversation", async () => {
      const callsBefore = (await chatRequestsFor(mock, conversationId)).length;
      await sendVisitorMessage(visitor, after);
      await holdsFor(
        request,
        async () => [(await chatRequestsFor(mock, conversationId)).length, await visitorAnyAiReply(visitor).count()],
        [callsBefore, 0],
        "no AI call and no AI reply while a person has to answer",
      );
      await expect(visitor.messages.getByText(anyOf(inHours, offHours))).toHaveCount(1);
    });
  } finally {
    await visitor.context.close();
    await supervisor.close();
    await viewer.close();
  }
});
