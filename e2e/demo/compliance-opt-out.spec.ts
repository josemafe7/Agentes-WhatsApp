// Bajas ([CUM-03], [CUM-04], [CUM-13]) as the business sees them: a customer of the demo WhatsApp (through the
// simulator, so nothing ever reaches Meta, [AJU-13]) writes «BAJA». They get ONE confirmation and the AI stays quiet;
// their message waits for a person, who can still answer them, warned over the composer that the AI, the reminders,
// the templates and the envíos are stopped. [HER-16] Said in their own words («no me mandéis más mensajes»), the AI
// records the same baja and the app sends the same one confirmation; the AI writes nothing more. Needs the demo seed's
// WhatsApp channel (with its agent's AI on, for the second test).
import { authStatePath } from "../support/app";
import { untilWithQueue } from "../support/engine";
import { conversationLog, replyBox, sendReplyButton } from "../support/inbox";
import { uniqueMessage, uniqueName, uniquePhone } from "../support/names";
import { DEMO_WHATSAPP, openSimulatedConversation, simulateTextMessage } from "../support/simulator";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

/** The confirmation the customer gets (src/server/compliance/opt-out.ts). */
const CONFIRMATION = "Listo: te hemos dado de baja y no te enviaremos más mensajes por este canal.";
/** The warning over the composer (src/server/compliance/opt-out.ts, OPTED_OUT_COMPOSER_WARNING). */
const WARNING = "Este cliente se ha dado de baja en este canal: la IA, los recordatorios, las plantillas y los envíos están parados.";

test("[CUM-03][CUM-04][CUM-13] a customer who writes «BAJA» gets one confirmation and the AI stays quiet; a person can still answer them, with a warning over the composer", async ({
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

  await test.step("[CUM-04] the composer warns that the AI, the reminders, the templates and the envíos are stopped", async () => {
    await expect(page.getByRole("main").getByRole("status").filter({ hasText: WARNING })).toBeVisible();
  });

  await test.step("[CUM-04] a person's message still reaches the customer (through the simulator: nothing reaches Meta)", async () => {
    const text = uniqueMessage(testInfo, "Te echaremos de menos");
    await replyBox(page).fill(text);
    await sendReplyButton(page).click();
    await expect(conversationLog(page).getByText(text, { exact: true })).toBeVisible();
    await expect(replyBox(page)).toHaveValue("");
    expect(await mock.requests({ service: "meta" })).toHaveLength(0);
  });
});

test("[HER-16][CUM-03] «no me mandéis más mensajes» in the customer's words: the AI records the baja, the app's one confirmation goes and the AI says nothing more", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(120_000);
  expect(openRouterKey).toBeTruthy();
  await simulateTextMessage(page, {
    channel: DEMO_WHATSAPP,
    contactName: uniqueName(testInfo, "Cliente que no quiere mensajes"),
    phone: uniquePhone(testInfo),
    text: uniqueMessage(testInfo, "Por favor, no me mandéis más mensajes"),
  });
  await openSimulatedConversation(page);

  const confirmation = conversationLog(page).getByText(CONFIRMATION);
  await untilWithQueue(request, async () => (await confirmation.count()) > 0, "the confirmation shows in the conversation");
  await expect(confirmation).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: WARNING })).toBeVisible();
  // The AI's own words after the tool never go: the baja stopped it ([CUM-04]).
  await expect(conversationLog(page).getByText("Hecho: no te enviaremos")).toHaveCount(0);
  expect(await mock.requests({ service: "meta" })).toHaveLength(0);
});
