// Ajustes › Diagnóstico › Simulador de canales ([AJU-11]–[AJU-13]): a simulated WhatsApp message on the demo channel
// enters by the same path as a real one, shows in the Bandeja and gets the agent's reply, which never leaves the app
// (the simulated Meta must receive nothing). Needs the demo seed's WhatsApp channel with an active agent and its AI on.
import { messageText } from "../support/ai";
import { authStatePath } from "../support/app";
import { chatRequestsFor, untilWithQueue } from "../support/engine";
import { anyAiAuthor, conversationLog, customerMessage, DELIVERY_STATE } from "../support/inbox";
import { uniqueMessage, uniqueName, uniquePhone } from "../support/names";
import { DEMO_WHATSAPP, openSimulatedConversation, simulateTextMessage } from "../support/simulator";
import { expect, test } from "../support/test";
import { escapeRegExp } from "../support/ui";

test.use({ storageState: authStatePath("owner") });

test("[AJU-12][AJU-13][CAN-09][CAN-13][BAN-05][MOT-11] the simulator's WhatsApp message reaches the Bandeja and gets the agent's reply, which never goes to Meta", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(120_000);
  expect(openRouterKey).toBeTruthy();
  const text = uniqueMessage(testInfo, "Hola, ¿tenéis hueco el jueves para un corte?");

  const channel = await simulateTextMessage(page, {
    channel: DEMO_WHATSAPP,
    contactName: uniqueName(testInfo, "Cliente simulado"),
    phone: uniquePhone(testInfo),
    text,
  });
  expect(channel).toMatch(/WhatsApp/i);

  const conversationId = await openSimulatedConversation(page);
  await expect(customerMessage(page, text)).toBeVisible();

  // The agent answers as it would to a real message, written for WhatsApp.
  const log = conversationLog(page);
  const reply = log.getByText(new RegExp(`Te escribo por WhatsApp\\. Me has escrito: «${escapeRegExp(text)}»`));
  await untilWithQueue(request, async () => (await reply.count()) > 0, "the agent's reply shows in the conversation");
  await expect(reply).toHaveCount(1);
  await expect(anyAiAuthor(page).first()).toBeVisible();
  // [BAN-05] With its delivery state (the demo channel simulates «Entregado» and «Leído»); [AJU-13] marked as simulated.
  await expect(log).toContainText(DELIVERY_STATE);
  await expect(log).toContainText("Simulado");

  // One turn of the demo agent, which searches its knowledge base first («Automático» with buscar_conocimiento since
  // fase 4, [AGE-07], [HER-01]): the call that asks for the search and the call that answers with its result.
  const calls = await chatRequestsFor(mock, conversationId);
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(messageText(call.body.messages[0])).toContain("Canal: WhatsApp");
  expect(calls[0].body.tools?.map((tool) => tool.function?.name)).toContain("buscar_conocimiento");
  expect(calls[1].body.messages.at(-1)?.role).toBe("tool");
  // [AJU-13] Nothing reached Meta: the reply to a simulated message never leaves the app.
  expect(await mock.requests({ service: "meta" })).toHaveLength(0);
});
