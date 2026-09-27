// Fase 2 acceptance on /widget-demo: the channel's active agent answers a visitor once; after changing the active agent
// from the channel's card, the new one answers; several quick messages get one reply ([WEB-*], [CAN-*], [MOT-*]).
// Each test sets up its own agents (from the demo template) and its own web chat, and each visitor is a new browser.
// The simulated OpenRouter answers «Soy <agente>, el asistente de IA de este negocio. Te escribo por chat de la web.
// Me has escrito: «…»», reading the agent from «Te llamas <agente>.» of the prompt, so a reply says who wrote it.
// Replies wait REPLY_DEBOUNCE_MS (e2e/support/env.ts) instead of 4–8 s.
import { messageText } from "../support/ai";
import { createNamedAgent } from "../support/agents";
import { authStatePath } from "../support/app";
import {
  activeAgentOnCard,
  appearancePath,
  channelAiSwitch,
  channelCard,
  channelIdsInCode,
  CHANNELS_PATH,
  pickActiveAgentOnCard,
  REPLACE_AGENT,
  setUpWebchat,
  textAndFieldsOf,
  widgetDemoPath,
} from "../support/channels";
import { chatRequestsFor, holdsFor, untilWithQueue } from "../support/engine";
import { aiAuthor, openConversationWith } from "../support/inbox";
import { uniqueMessage, uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { clickAndWaitForPost } from "../support/ui";
import { openVisitor, sendVisitorMessage, visitorAiReplies, WIDGET_DEMO_NOTICE } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

test("[WEB-01][WEB-06][WEB-12][CAN-01][CAN-04][MOT-08][MOT-10][BAN-05] on /widget-demo a visitor writes and the channel's active agent replies, once", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(150_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Recepción web");

  await test.step("[CAN-01][CAN-04] Canales shows the web chat with its active agent and the AI on", async () => {
    await page.goto(CHANNELS_PATH);
    const card = channelCard(page, setup.channelName);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Chat web");
    await expect.poll(() => activeAgentOnCard(page, setup.channelName)).toContain(setup.agentName);
    await expect(channelAiSwitch(card)).toBeChecked();
  });

  const demoPath = await test.step("[WEB-01] its code to paste names the channel, and it opens in /widget-demo", async () => {
    const path = await widgetDemoPath(page, setup.channelId);
    await expect(page).toHaveURL(new RegExp(`${appearancePath(setup.channelId)}$`));
    expect(await textAndFieldsOf(page)).toMatch(/<script src="https?:\/\/[^"]+\/widget\.js"/);
    expect(await channelIdsInCode(page)).toContain(setup.channelId);
    return path;
  });

  const text = uniqueMessage(testInfo, "Hola, ¿abrís el sábado por la mañana?");
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    // [WEB-12] The example page of the business with the chat working.
    await expect(visitor.page.getByText(WIDGET_DEMO_NOTICE).first()).toBeVisible();
    await sendVisitorMessage(visitor, text);

    const replies = visitorAiReplies(visitor, setup.agentName);
    await untilWithQueue(request, async () => (await replies.count()) > 0, "the active agent's reply reaches the visitor");
    await expect(replies).toContainText("Te escribo por chat de la web");
    await expect(replies).toContainText(`Me has escrito: «${text}»`);
    // [MOT-10] One reply, never repeated nor split.
    await holdsFor(request, () => replies.count(), 1, "the visitor gets exactly one reply");

    // [BAN-05] The conversation is in the inbox, with the reply signed by the agent that wrote it.
    const conversationId = await openConversationWith(page, text);
    await expect(aiAuthor(page, setup.agentName)).toHaveCount(1);

    // [MOT-08] One call for the conversation (its session), with the active agent's prompt for the web chat.
    const calls = await chatRequestsFor(mock, conversationId);
    expect(calls).toHaveLength(1);
    const prompt = messageText(calls[0].body.messages[0]);
    expect(prompt).toContain(`Te llamas ${setup.agentName}.`);
    expect(prompt).toContain("Canal: chat de la web");
    expect(calls[0].body.stream).toBe(false);
    expect(calls[0].body.provider?.data_collection).toBe("deny");
  } finally {
    await visitor.context.close();
  }
});

test("[CAN-04][CAN-05][AGE-10] after changing the channel's active agent on its card (confirmed), the new agent answers the next message; the earlier reply keeps its agent", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Agente de mañana");
  const newAgent = uniqueName(testInfo, "Agente de tarde");
  await createNamedAgent(page, newAgent);
  const demoPath = await widgetDemoPath(page, setup.channelId);

  const first = uniqueMessage(testInfo, "Buenos días, ¿cuánto cuesta un corte?");
  const second = uniqueMessage(testInfo, "¿Y el tinte de raíz?");
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, first);
    const oldReplies = visitorAiReplies(visitor, setup.agentName);
    await untilWithQueue(request, async () => (await oldReplies.count()) === 1, "the first agent answers");

    await test.step("[CAN-04][AGE-10] the owner picks the other agent on the card and confirms the replacement", async () => {
      await pickActiveAgentOnCard(page, setup.channelName, newAgent);
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      // «Sustituirá a …»: it says which agent stops answering here.
      await expect(confirm).toContainText(setup.agentName);
      await clickAndWaitForPost(page, confirm.getByRole("button", { name: REPLACE_AGENT }));
      await expect(confirm).toHaveCount(0);
      await page.reload();
      await expect.poll(() => activeAgentOnCard(page, setup.channelName)).toContain(newAgent);
    });

    await sendVisitorMessage(visitor, second);
    const newReplies = visitorAiReplies(visitor, newAgent);
    await untilWithQueue(request, async () => (await newReplies.count()) === 1, "the new agent answers the next message");
    await expect(newReplies).toContainText(`Me has escrito: «${second}»`);
    await holdsFor(request, async () => [await oldReplies.count(), await newReplies.count()], [1, 1], "one reply per message");

    // [CAN-05] Each reply keeps the agent that wrote it.
    const conversationId = await openConversationWith(page, first);
    await expect(aiAuthor(page, setup.agentName)).toHaveCount(1);
    await expect(aiAuthor(page, newAgent)).toHaveCount(1);
    const prompts = (await chatRequestsFor(mock, conversationId)).map((call) => messageText(call.body.messages[0]));
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain(`Te llamas ${setup.agentName}.`);
    expect(prompts[1]).toContain(`Te llamas ${newAgent}.`);
  } finally {
    await visitor.context.close();
  }
});

test("[MOT-01][MOT-02][MOT-10] three quick messages from the visitor get one single reply that answers all of them", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(150_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Agente paciente");
  const demoPath = await widgetDemoPath(page, setup.channelId);
  const texts = [
    uniqueMessage(testInfo, "Hola"),
    uniqueMessage(testInfo, "Quería pedir cita para un corte"),
    uniqueMessage(testInfo, "Mejor por la tarde, si puede ser"),
  ];
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    // One after another, well inside the wait before replying.
    for (const text of texts) await sendVisitorMessage(visitor, text);

    const replies = visitorAiReplies(visitor, setup.agentName);
    await untilWithQueue(request, async () => (await replies.count()) > 0, "the agent answers");
    await holdsFor(request, () => replies.count(), 1, "one reply for the three messages");
    await expect(replies).toContainText(texts[2]);

    // The reply that was sent was prepared with the three messages.
    const conversationId = await openConversationWith(page, texts[0]);
    await expect(aiAuthor(page, setup.agentName)).toHaveCount(1);
    const calls = await chatRequestsFor(mock, conversationId);
    const answered = calls.at(-1);
    expect(answered, "the model was asked").toBeDefined();
    const customerText = (answered?.body.messages ?? [])
      .filter((message) => message.role === "user")
      .map(messageText)
      .join("\n");
    for (const text of texts) expect(customerText).toContain(text);
  } finally {
    await visitor.context.close();
  }
});
