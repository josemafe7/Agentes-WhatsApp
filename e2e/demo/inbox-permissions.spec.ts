// Who sees and answers what in the Bandeja ([PER-02], [PER-03], [SEG-04]): a person with the Agente role only sees the
// conversations of the channels they attend, even typing another one's address; Solo lectura sees them but has no way
// to reply. The server checks are also proved in Vitest (src/data/conversations.test.ts, messages.test.ts); here it is
// the screen. Two web chats of the test's own, without agent or AI (the messages wait for a person, [CAN-03]).
import { authStatePath, newPersonContext } from "../support/app";
import { createWebchatChannel, widgetDemoPath } from "../support/channels";
import { conversationPath, customerMessage, openConversationWith, replyBox, searchInbox, sendReplyButton } from "../support/inbox";
import { uniqueMessage, uniqueName } from "../support/names";
import { setAgentUserChannels } from "../support/team";
import { clientIpFor, expect, test } from "../support/test";
import { expectRefused } from "../support/ui";
import { DEMO_USERS } from "../support/users";
import { openVisitor, sendVisitorMessage } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

test("[PER-02][PER-03][BAN-01][SEG-04] an Agent only sees the conversations of their channels; Solo lectura sees them but cannot reply", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const channels = {
    mine: { name: uniqueName(testInfo, "Chat web de Pablo"), text: uniqueMessage(testInfo, "Hola, ¿abrís los domingos?"), conversationId: "" },
    other: { name: uniqueName(testInfo, "Chat web de otro equipo"), text: uniqueMessage(testInfo, "Hola, quería una información"), conversationId: "" },
  };

  // A visitor writes on each web chat; the owner finds both conversations.
  for (const [label, channel] of Object.entries(channels)) {
    const channelId = await createWebchatChannel(page, channel.name);
    const visitor = await openVisitor(browser, testInfo, await widgetDemoPath(page, channelId), label);
    try {
      await sendVisitorMessage(visitor, channel.text);
    } finally {
      await visitor.context.close();
    }
    channel.conversationId = await openConversationWith(page, channel.text);
  }

  const agentName = DEMO_USERS.agent.name;
  const previous = await setAgentUserChannels(page, agentName, [channels.mine.name]);
  const agent = await newPersonContext(browser, testInfo, {
    clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:agent`),
    storageState: authStatePath("agent"),
  });
  const viewer = await newPersonContext(browser, testInfo, {
    clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:viewer`),
    storageState: authStatePath("viewer"),
  });
  try {
    const agentPage = await agent.newPage();
    await test.step("[PER-02][BAN-01] the Agent finds and answers the conversation of their channel", async () => {
      await expect(await searchInbox(agentPage, channels.mine.text)).toHaveCount(1);
      await agentPage.goto(conversationPath(channels.mine.conversationId));
      await expect(customerMessage(agentPage, channels.mine.text)).toBeVisible();
      await expect(replyBox(agentPage)).toBeEditable();
    });

    await test.step("[PER-02][SEG-04] the conversation of another channel is neither listed nor opened by its address", async () => {
      await expect(await searchInbox(agentPage, channels.other.text)).toHaveCount(0);
      await expectRefused(agentPage, conversationPath(channels.other.conversationId));
      await expect(agentPage.getByText(channels.other.text)).toHaveCount(0);
    });

    await test.step("[PER-03] Solo lectura sees the conversation without a composer", async () => {
      const viewerPage = await viewer.newPage();
      await viewerPage.goto(conversationPath(channels.mine.conversationId));
      await expect(customerMessage(viewerPage, channels.mine.text)).toBeVisible();
      await expect(replyBox(viewerPage)).toHaveCount(0);
      await expect(sendReplyButton(viewerPage)).toHaveCount(0);
    });
  } finally {
    await agent.close();
    await viewer.close();
    await setAgentUserChannels(page, agentName, previous);
  }
});
