// The reply arrives without anyone running the queue ([MOT-15], [CAN-10]): the widget request stores the message and
// answers at once; after the answer, after() + kickTick (src/server/inbound/ingest.ts) wait for the reply job and run it.
// The e2e app runs under `next start`, with no local ticker and no cron: unlike the other specs, this one never calls
// /api/cron/tick, so the reply can only come from that kick.
import { authStatePath } from "../support/app";
import { setUpWebchat, widgetDemoPath } from "../support/channels";
import { chatRequestsFor, REPLY_TIMEOUT_MS } from "../support/engine";
import { openConversationWith } from "../support/inbox";
import { uniqueMessage } from "../support/names";
import { expect, test } from "../support/test";
import { openVisitor, sendVisitorMessage, visitorAiReplies } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

test("[MOT-15][CAN-10][WEB-06] without cron or ticker, the reply to a web chat message arrives by itself, once", async ({ page, browser, mock, openRouterKey }, testInfo) => {
  test.setTimeout(120_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Agente sin cron");
  const demoPath = await widgetDemoPath(page, setup.channelId);
  const text = uniqueMessage(testInfo, "¿Hasta qué hora abrís hoy?");
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, text);
    // No runQueue here: only the kick of the widget request can produce it.
    await expect(visitorAiReplies(visitor, setup.agentName)).toHaveCount(1, { timeout: REPLY_TIMEOUT_MS });
    await expect(visitorAiReplies(visitor, setup.agentName)).toContainText(`Me has escrito: «${text}»`);

    const conversationId = await openConversationWith(page, text);
    expect(await chatRequestsFor(mock, conversationId)).toHaveLength(1);
  } finally {
    await visitor.context.close();
  }
});
