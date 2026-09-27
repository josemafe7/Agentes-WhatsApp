// [BAN-16] A person answers a visitor (the AI pauses, [BAN-11]); the visitor writes again and the paused AI stays
// quiet; when the person reactivates the AI, it answers that unanswered message by itself, a few seconds later. Each
// test sets up its own agent and web chat; the visitor is a new browser on /widget-demo. The simulated OpenRouter
// answers «Soy <agente>… Me has escrito: «…»».
import { authStatePath } from "../support/app";
import { setUpWebchat, widgetDemoPath } from "../support/channels";
import { chatRequestsFor, holdsFor, untilWithQueue } from "../support/engine";
import { aiPausedNotice, openConversationWith, replyAsPerson } from "../support/inbox";
import { uniqueMessage } from "../support/names";
import { expect, test } from "../support/test";
import { openVisitor, sendVisitorMessage, visitorAiReplies } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

test("[BAN-16][BAN-10][BAN-11][MOT-01] reactivating the AI answers the message the visitor left unanswered meanwhile", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(150_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Agente que vuelve");
  const demoPath = await widgetDemoPath(page, setup.channelId);
  const first = uniqueMessage(testInfo, "Hola, ¿hacéis tintes?");
  const waiting = uniqueMessage(testInfo, "¿Y el sábado por la mañana?");
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, first);
    const replies = visitorAiReplies(visitor, setup.agentName);
    await untilWithQueue(request, async () => (await replies.count()) === 1, "the agent answers the first message");

    const conversationId = await openConversationWith(page, first);
    await replyAsPerson(page, uniqueMessage(testInfo, "Hola, soy Elena. Sí, los hacemos."));
    await expect(aiPausedNotice(page)).toBeVisible();

    await sendVisitorMessage(visitor, waiting);
    await holdsFor(request, async () => replies.count(), 1, "the paused AI does not answer");

    await page.getByRole("main").getByRole("button", { name: "Reactivar" }).click();
    await expect(aiPausedNotice(page)).toHaveCount(0);
    // [BAN-16] The AI answers the message that was waiting, with nobody writing again.
    await untilWithQueue(request, async () => (await replies.count()) === 2, "the reactivated AI answers the waiting message");
    await expect(replies.nth(1)).toContainText(waiting);
    const calls = await chatRequestsFor(mock, conversationId);
    expect(JSON.stringify(calls.at(-1)?.body.messages ?? [])).toContain(waiting);
  } finally {
    await visitor.context.close();
  }
});
