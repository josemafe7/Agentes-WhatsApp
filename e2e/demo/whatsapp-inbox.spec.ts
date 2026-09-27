// A WhatsApp conversation in the Bandeja ([BAN-08], [WA-43], [CAN-06], [CAN-14]): the 24 h window counted from Meta's
// timestamp of the customer's last message, only approved templates (with their variables) once it is closed, Meta's
// 131047 closing it early, and test mode letting the AI answer only the listed numbers. Each test connects a number of
// its own through the wizard (templates synced there) and leaves it disabled.
import { createNamedAgent } from "../support/agents";
import { authStatePath } from "../support/app";
import { chatRequestsFor, holdsFor, untilWithQueue } from "../support/engine";
import { conversationLog, openConversationWith, replyAsPerson, replyBox, sendReplyButton } from "../support/inbox";
import { uniqueMessage, uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { chooseTemplateButton, connectWhatsAppNumber, disableChannelQuietly, offeredTemplates, sendTemplate, windowIndicator } from "../support/whatsapp";
import { deliverWebhook, e164, META, nextSendFails, readReceipts, sentMessages, testCustomer, testNumber, testWamid, webhookBody } from "../support/whatsapp-meta";

test.use({ storageState: authStatePath("owner") });

const HOUR_MS = 60 * 60_000;
/** The approved templates of the simulated Meta (e2e/mocks/routes/meta-data.json), the only ones offered ([WA-43]). */
const APPROVED = META.templates.filter((template) => template.status === "APPROVED").map((template) => template.name);

test("[WA-43][BAN-08][CAN-14][WA-22][WA-42] outside the 24 h window only an approved template can be sent, with its variables", async ({ page, request, mock }, testInfo) => {
  test.setTimeout(180_000);
  const number = testNumber(testInfo, "WhatsApp ventana cerrada");
  const customer = testCustomer(testInfo, "Pedro ventana");
  let channelId: string | null = null;
  try {
    channelId = await connectWhatsAppNumber(page, number);
    // Meta's timestamp says the customer wrote 25 hours ago (a late retry, [WA-35]): the window counts from it.
    const text = uniqueMessage(testInfo, "¿Me confirmáis la cita del jueves?");
    await deliverWebhook(request, webhookBody("text", { number, customer, text, at: new Date(Date.now() - 25 * HOUR_MS) }));
    await openConversationWith(page, text);

    await expect(windowIndicator(page)).toContainText(/cerrada/i);
    // [WA-43] No free text to the customer: only internal notes stay in the composer.
    await expect(sendReplyButton(page)).toHaveCount(0);
    await expect(chooseTemplateButton(page)).toBeVisible();

    // [WA-22][WA-43] Only the approved ones, never the pending or the rejected one.
    expect((await offeredTemplates(page)).sort()).toEqual([...APPROVED].sort());

    await sendTemplate(page, "recordatorio_cita", { nombre: "Pedro", fecha: "3 de octubre", hora: "10:30" });
    await expect(conversationLog(page)).toContainText("Hola Pedro, te recordamos tu cita el 3 de octubre a las 10:30.");
    await expect.poll(async () => (await sentMessages(mock, number)).length).toBe(1);
    const [sent] = await sentMessages(mock, number);
    expect(sent).toMatchObject({ to: e164(customer), type: "template" });
    expect(sent.template).toMatchObject({ name: "recordatorio_cita", language: { code: "es" } });
    // NAMED parameters, each with its name ([WA-42], docs/integracion-whatsapp-mensajes.md §11.4).
    expect(sent.template?.components).toEqual([
      {
        type: "body",
        parameters: expect.arrayContaining([
          { type: "text", parameter_name: "nombre", text: "Pedro" },
          { type: "text", parameter_name: "fecha", text: "3 de octubre" },
          { type: "text", parameter_name: "hora", text: "10:30" },
        ]),
      },
    ]);
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[WA-43][BAN-08][BAN-13] inside the window there is free text and the time left; when Meta answers 131047 the window closes and a template is needed", async ({
  page,
  request,
  mock,
}, testInfo) => {
  test.setTimeout(180_000);
  const number = testNumber(testInfo, "WhatsApp ventana abierta");
  const customer = testCustomer(testInfo, "Rosa ventana");
  let channelId: string | null = null;
  try {
    channelId = await connectWhatsAppNumber(page, number);
    const text = uniqueMessage(testInfo, "Hola, ¿abrís el sábado?");
    await deliverWebhook(request, webhookBody("text", { number, customer, text }));
    await openConversationWith(page, text);

    await expect(windowIndicator(page)).toContainText(/abierta/i);
    // «23 h 59 min» or so: the time left of the 24 h ([BAN-08]).
    await expect(page.getByRole("main").getByText(/\b\d{1,2} h \d{1,2} min\b/).first()).toBeVisible();
    await expect(replyBox(page)).toBeEnabled();

    // Meta knows better ([WA-43] and docs §13): its 131047 closes the window although 24 h have not passed.
    await nextSendFails(mock, number, {
      code: 131047,
      message: "Re-engagement message",
      details: "More than 24 hours have passed since the recipient last replied to the sender number.",
    });
    const reply = uniqueMessage(testInfo, "Sí, de 10 a 14");
    await replyAsPerson(page, reply);
    // [BAN-13] The failed send shows Meta's error in Spanish.
    await expect(conversationLog(page)).toContainText("La ventana de 24 h está cerrada", { timeout: 15_000 });
    await page.reload();
    await expect(windowIndicator(page)).toContainText(/cerrada/i);
    await expect(chooseTemplateButton(page)).toBeVisible();
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[CAN-06][WA-25][WA-44][WA-45] in test mode the AI answers only the listed numbers; the others wait for a person", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(240_000);
  expect(openRouterKey).toBeTruthy();
  const number = testNumber(testInfo, "WhatsApp modo pruebas");
  const listed = testCustomer(testInfo, "Dueño en la lista");
  const other = testCustomer(testInfo, "Cliente fuera de la lista");
  const agentName = uniqueName(testInfo, "Agente pruebas");
  let channelId: string | null = null;
  try {
    await createNamedAgent(page, agentName);
    // [WA-25] Test mode stays on, with only the owner's number (as Meta gives it: with its prefix).
    channelId = await connectWhatsAppNumber(page, number, { agentName, aiEnabled: true, testMode: true, allowlist: [e164(listed)] });

    const listedText = uniqueMessage(testInfo, "Soy yo, probando el agente");
    const otherText = uniqueMessage(testInfo, "Hola, ¿cuánto cuesta un corte?");
    const listedWamid = testWamid(testInfo, "en la lista");
    const otherWamid = testWamid(testInfo, "fuera de la lista");
    await deliverWebhook(request, webhookBody("text", { number, customer: listed, text: listedText, wamid: listedWamid }));
    await deliverWebhook(request, webhookBody("text", { number, customer: other, text: otherText, wamid: otherWamid }));
    const listedConversation = await openConversationWith(page, listedText);
    const otherConversation = await openConversationWith(page, otherText);

    await untilWithQueue(request, async () => (await sentMessages(mock, number)).some((sent) => sent.to === e164(listed)), "the AI answers the listed number");
    await holdsFor(
      request,
      async () => ({ calls: (await chatRequestsFor(mock, otherConversation)).length, sends: (await sentMessages(mock, number)).filter((sent) => sent.to === e164(other)).length }),
      { calls: 0, sends: 0 },
      "[CAN-06] nothing for a number that is not listed",
    );
    // [WA-44] One reply for the listed customer's turn.
    expect(await chatRequestsFor(mock, listedConversation)).toHaveLength(1);
    expect((await sentMessages(mock, number)).filter((sent) => sent.to === e164(listed))).toHaveLength(1);
    // [WA-45] «Leído» and «escribiendo…» only where the AI was going to answer.
    const receipts = await readReceipts(mock, number);
    expect(receipts).toContainEqual(expect.objectContaining({ message_id: listedWamid, typing_indicator: { type: "text" } }));
    expect(receipts.filter((receipt) => receipt.message_id === otherWamid && receipt.typing_indicator !== undefined)).toHaveLength(0);
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});
