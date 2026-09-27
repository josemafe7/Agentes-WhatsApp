// Bajas ([CUM-03], [CUM-04], [CUM-13]) as the business sees them: a customer of the demo WhatsApp (through the
// simulator, so nothing ever reaches Meta, [AJU-13]) writes «BAJA». They get ONE confirmation, the AI stays quiet, and a
// person of the team who tries to write to them is told why nothing can be sent. Needs the demo seed's WhatsApp channel.
import { authStatePath } from "../support/app";
import { untilWithQueue } from "../support/engine";
import { conversationLog, replyBox, sendReplyButton } from "../support/inbox";
import { uniqueMessage, uniqueName, uniquePhone } from "../support/names";
import { DEMO_WHATSAPP, openSimulatedConversation, simulateTextMessage } from "../support/simulator";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

/** The confirmation the customer gets (src/server/compliance/opt-out.ts). */
const CONFIRMATION = "Listo: te hemos dado de baja y no te enviaremos más mensajes por este canal.";
/** Why a person's message is refused. */
const REFUSED = "El cliente se ha dado de baja en este canal";

test("[CUM-03][CUM-04][CUM-13] a customer who writes «BAJA» gets one confirmation, and from then on nobody can write to them in that channel", async ({
  page,
  request,
  mock,
}, testInfo) => {
  test.setTimeout(120_000);
  await simulateTextMessage(page, {
    channel: DEMO_WHATSAPP,
    contactName: uniqueName(testInfo, "Cliente que se da de baja"),
    phone: uniquePhone(testInfo),
    text: "¡Baja!",
  });
  // [CUM-04] The simulator already tells why the AI will not answer: the message waits for a person.
  await expect(page.getByRole("main")).toContainText("se ha dado de baja en este canal");
  await openSimulatedConversation(page);

  await test.step("[CUM-03] one confirmation in the conversation, and nothing reaches Meta [AJU-13]", async () => {
    const confirmation = conversationLog(page).getByText(CONFIRMATION);
    await untilWithQueue(request, async () => (await confirmation.count()) > 0, "the confirmation shows in the conversation");
    await expect(confirmation).toHaveCount(1);
    expect(await mock.requests({ service: "meta" })).toHaveLength(0);
  });

  await test.step("[CUM-03] a person's message is refused with the reason, and it is not in the conversation", async () => {
    const text = uniqueMessage(testInfo, "Te echaremos de menos");
    await replyBox(page).fill(text);
    await sendReplyButton(page).click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: REFUSED })).toBeVisible();
    await expect(conversationLog(page).getByText(text, { exact: true })).toHaveCount(0);
  });
});
