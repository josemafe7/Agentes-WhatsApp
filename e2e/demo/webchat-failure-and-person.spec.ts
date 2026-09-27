// Fase 2 acceptance, two ways a web chat conversation reaches a person: the AI fails twice ([MOT-12], and the error
// shows in Ajustes › Diagnóstico, [AJU-11]), or the visitor presses «Hablar con una persona» in the chat ([TRA-09]).
// Each test sets up its own agent (demo template, whose hand-off keywords include «hablar con una persona») and web
// chat; visitors are new browsers on /widget-demo. A stub makes only this conversation's model calls fail
// (`when.bodyIncludes` with its unique message), so nothing else in the queue can use it.
import { CHAT_COMPLETIONS_PATH } from "../support/ai";
import { agentPath, expectSaved, saveEditor } from "../support/agents";
import { authStatePath } from "../support/app";
import { setUpWebchat, widgetDemoPath } from "../support/channels";
import { chatRequestsFor, holdsFor, untilWithQueue } from "../support/engine";
import { anyOf, openConversationWith, pendingHumanState } from "../support/inbox";
import { uniqueMessage } from "../support/names";
import { expect, test } from "../support/test";
import { openVisitor, sendVisitorMessage, visitorAiReplies, visitorAnyAiReply } from "../support/widget";

test.use({ storageState: authStatePath("owner") });

const DIAGNOSTICS_PATH = "/ajustes/diagnostico";

test("[MOT-12][AJU-11] the AI fails again on its retry: the visitor gets nothing, the conversation waits for a person with the notice, and the error shows in Diagnóstico", async ({
  page,
  browser,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(150_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Agente que falla");
  const demoPath = await widgetDemoPath(page, setup.channelId);
  const text = uniqueMessage(testInfo, "Hola, quiero pedir cita para el jueves");
  await mock.stub({
    service: "openrouter",
    method: "POST",
    path: CHAT_COMPLETIONS_PATH,
    status: 500,
    body: { error: { code: 500, message: "Internal Server Error" } },
    times: 2,
    when: { bodyIncludes: text },
  });

  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, text);
    const conversationId = await openConversationWith(page, text);

    await test.step("[MOT-12] tried twice, nothing reaches the visitor, and the conversation is «Pendiente de humano»", async () => {
      await untilWithQueue(request, async () => (await pendingHumanState(page).count()) > 0, "the conversation goes to a person");
      expect(await chatRequestsFor(mock, conversationId)).toHaveLength(2);
      await holdsFor(request, () => visitorAnyAiReply(visitor).count(), 0, "the visitor never gets a reply");
      const main = page.getByRole("main");
      await expect(main).toContainText("La IA no ha podido responder");
      await expect(main).toContainText("La IA ha fallado");
      await expect(main).toContainText("tras reintentarlo");
      await expect(main).not.toContainText("Se reintentará");
    });

    await test.step("[AJU-11] Diagnóstico › Errores recientes de la IA lists both failed calls, linked to the conversation", async () => {
      await page.goto(DIAGNOSTICS_PATH);
      const errors = page.locator("#errores-recientes");
      await expect(errors).toContainText("Errores recientes de la IA");
      await expect(errors).toContainText("Error interno de OpenRouter");
      await expect(errors).toContainText(setup.channelName);
      await expect(errors.locator(`a[href="/bandeja/${conversationId}"]`)).toHaveCount(2);
    });
  } finally {
    await visitor.context.close();
  }
});

test("[WEB-03] the chat works with the keyboard alone, names itself for screen readers and fills a phone's screen", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const setup = await setUpWebchat(page, testInfo, "Agente accesible");
  const demoPath = await widgetDemoPath(page, setup.channelId);
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    // A modal dialog with a name; the conversation is the list «Mensajes» (empty until someone writes).
    await expect(visitor.panel).toHaveAttribute("aria-modal", "true");
    await expect(visitor.panel).toHaveAccessibleName(/\S/);
    await expect(visitor.messages).toBeAttached();

    // Esc closes it and gives the focus back to the launcher; Enter opens it again with the focus in the text box.
    await visitor.messageBox.focus();
    await visitor.page.keyboard.press("Escape");
    await expect(visitor.panel).toBeHidden();
    const launcher = visitor.page.getByRole("button", { name: /^Abrir el chat/i });
    await expect(launcher).toBeFocused();
    await visitor.page.keyboard.press("Enter");
    await expect(visitor.panel).toBeVisible();
    await expect(visitor.messageBox).toBeFocused();

    // Written and sent with the keyboard only.
    const text = uniqueMessage(testInfo, "Escrito solo con el teclado");
    await visitor.page.keyboard.type(text);
    await visitor.page.keyboard.press("Enter");
    await expect(visitor.messages.getByText(text, { exact: true })).toBeVisible();

    // On a phone the panel takes the whole screen.
    await visitor.page.setViewportSize({ width: 375, height: 740 });
    await expect.poll(async () => (await visitor.panel.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(375);
  } finally {
    await visitor.context.close();
  }
});

test("[TRA-09][CUM-02] «Hablar con una persona» in the chat hands the conversation to a person, with the agent's message", async ({
  page,
  browser,
  request,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(150_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpWebchat(page, testInfo, "Agente con botón");
  const inHours = uniqueMessage(testInfo, "Te paso con el equipo ahora mismo.");
  const offHours = uniqueMessage(testInfo, "Estamos cerrados; el equipo te contestará al abrir.");
  await page.goto(agentPath(setup.agentId, "traspaso"));
  await page.getByLabel(/dentro de horario/i).fill(inHours);
  await page.getByLabel(/fuera de horario/i).fill(offHours);
  await saveEditor(page);
  await expectSaved(page);

  const demoPath = await widgetDemoPath(page, setup.channelId);
  const first = uniqueMessage(testInfo, "Hola, tengo una duda con mi reserva");
  const visitor = await openVisitor(browser, testInfo, demoPath);
  try {
    await sendVisitorMessage(visitor, first);
    await untilWithQueue(request, async () => (await visitorAiReplies(visitor, setup.agentName).count()) > 0, "the agent answers first");

    await visitor.panel.getByRole("button", { name: "Hablar con una persona" }).click();
    await expect(visitor.messages.getByText("Quiero hablar con una persona.", { exact: true })).toBeVisible();
    const handoffMessage = visitor.messages.getByText(anyOf(inHours, offHours));
    await untilWithQueue(request, async () => (await handoffMessage.count()) > 0, "the agent's hand-off message reaches the visitor");

    await openConversationWith(page, first);
    await expect(pendingHumanState(page)).toBeVisible();
  } finally {
    await visitor.context.close();
  }
});
