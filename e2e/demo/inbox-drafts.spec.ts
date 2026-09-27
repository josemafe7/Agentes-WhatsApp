// «Borrador para revisar» ([CAN-07], [MOT-14]): with the channel in draft mode the AI's reply waits in the Bandeja and
// never reaches the customer until a person approves it (as it is or edited) or discards it. Its own agent and web
// chat; the visitor is a new browser on /widget-demo.
import { expectSaved, saveEditor } from "../support/agents";
import { authStatePath } from "../support/app";
import { setUpWebchat, widgetDemoPath } from "../support/channels";
import { chatRequestsFor, holdsFor, untilWithQueue } from "../support/engine";
import { conversationLog, openConversationWith } from "../support/inbox";
import { uniqueMessage } from "../support/names";
import { expect, test } from "../support/test";
import { clickAndWaitForPost } from "../support/ui";
import { openVisitor, sendVisitorMessage, visitorAnyAiReply } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

const DRAFT_STATE = "Borrador de la IA · pendiente de revisar";

test("[CAN-07][MOT-14][BAN-05] in «Borrador para revisar» the AI's reply waits for a person: edited and approved it reaches the visitor; discarded, never", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Agente de borradores");

  await test.step("[CAN-07] the channel's reply mode is «Borrador para revisar»", async () => {
    await page.goto(`/canales/${setup.channelId}/configuracion`);
    await page.getByRole("radio", { name: "Borrador para revisar" }).click();
    await saveEditor(page);
    await expectSaved(page);
  });

  const demoPath = await widgetDemoPath(page, setup.channelId);
  const first = uniqueMessage(testInfo, "¿Tenéis cita el viernes por la mañana?");
  const edited = uniqueMessage(testInfo, "Sí, el viernes a las 10:00 tenemos hueco. ¿Te lo reservo?");
  const second = uniqueMessage(testInfo, "¿Y el sábado?");
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, first);
    const conversationId = await openConversationWith(page, first);
    const log = conversationLog(page);

    await test.step("[MOT-14] the AI answers as a draft: it shows in the Bandeja and the visitor gets nothing", async () => {
      await untilWithQueue(request, async () => (await chatRequestsFor(mock, conversationId)).length === 1, "the AI prepares its reply");
      await expect(log.getByText(DRAFT_STATE)).toHaveCount(1, { timeout: 15_000 });
      await holdsFor(request, () => visitorAnyAiReply(visitor).count(), 0, "a draft never reaches the visitor", 4_000);
    });

    await test.step("«Editar» and «Guardar y enviar»: the visitor gets the person's text, still signed by the agent", async () => {
      await page.getByRole("group", { name: "Revisar el borrador de la IA" }).getByRole("button", { name: "Editar" }).click();
      await page.getByLabel("Editar el borrador").fill(edited);
      await clickAndWaitForPost(page, page.getByRole("button", { name: "Guardar y enviar" }));
      await expect(visitor.messages.getByText(edited, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(log.getByText(DRAFT_STATE)).toHaveCount(0);
      await expect(log.getByText(edited, { exact: true })).toBeVisible();
    });

    await test.step("«Descartar» removes the next draft and the visitor never gets it", async () => {
      await sendVisitorMessage(visitor, second);
      await untilWithQueue(request, async () => (await chatRequestsFor(mock, conversationId)).length === 2, "the AI prepares the next reply");
      await expect(log.getByText(DRAFT_STATE)).toHaveCount(1, { timeout: 15_000 });
      await page.getByRole("group", { name: "Revisar el borrador de la IA" }).getByRole("button", { name: "Descartar" }).click();
      const confirm = page.getByRole("alertdialog");
      await clickAndWaitForPost(page, confirm.getByRole("button", { name: "Descartar" }));
      await expect(log.getByText(DRAFT_STATE)).toHaveCount(0);
      await holdsFor(request, () => visitorAnyAiReply(visitor).count(), 0, "a discarded draft never reaches the visitor", 4_000);
    });
  } finally {
    await visitor.context.close();
  }
});
