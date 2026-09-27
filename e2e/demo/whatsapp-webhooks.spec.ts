// Meta's webhooks as Meta sends them (the shared fixtures of src/test/fixtures/whatsapp, signed with the App Secret)
// against the compiled app, with the simulated Meta for media and sends: signatures, text, voice notes and images,
// statuses with pricing and their estimated cost, customers with only a BSUID, BSUID changes and duplicates. Each test
// connects a number of its own through the wizard and leaves it disabled.
import { messageText } from "../support/ai";
import { createNamedAgent } from "../support/agents";
import { authStatePath } from "../support/app";
import { chatRequestsFor, holdsFor, untilWithQueue } from "../support/engine";
import { anyAiAuthor, conversationLog, customerMessage, openConversationWith, replyAsPerson, searchInbox, systemMessage } from "../support/inbox";
import { uniqueMessage, uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { connectWhatsAppNumber, disableChannelQuietly, saveWhatsAppRate } from "../support/whatsapp";
import {
  deliverWebhook,
  duplicateDeliveries,
  e164,
  graphPath,
  META,
  metaCalls,
  nextSendGetsWamid,
  postWebhook,
  sentMessages,
  signWebhook,
  testCustomer,
  testNumber,
  testWamid,
  webhookBody,
} from "../support/whatsapp-meta";

test.use({ storageState: authStatePath("owner") });

/** The simulated OpenRouter's transcript of any voice note (e2e/mocks/routes/openrouter.mjs). */
const SIMULATED_TRANSCRIPT = /Transcripción simulada de una nota de voz/;
/** «El identificador de WhatsApp del cliente ha cambiado.» (src/server/channels/whatsapp/normalize.ts). */
const BSUID_CHANGED_NOTE = /identificador de WhatsApp del cliente ha cambiado/;
/** What a type WhatsApp does not let the app show becomes ([WA-36], src/server/channels/whatsapp/normalize.ts). */
const UNSUPPORTED_NOTE = "Tipo de mensaje no admitido";

test("[WA-32][WA-33][WA-34][WA-35][SEG-08][CAN-09][CAN-13][WA-36] a signed text webhook creates the contact and its conversation; a wrong or missing signature gets 401 and stores nothing; a number of no channel gets 200 and stores nothing", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const number = testNumber(testInfo, "WhatsApp firmas");
  const stranger = testNumber(testInfo, "Número de otro");
  const customer = testCustomer(testInfo, "Ana firma");
  let channelId: string | null = null;
  try {
    channelId = await connectWhatsAppNumber(page, number);

    await test.step("[WA-32][SEG-08] another app's secret, a malformed signature or none: 401, nothing stored", async () => {
      const forged = uniqueMessage(testInfo, "Mensaje con firma falsa");
      const body = webhookBody("text", { number, customer, text: forged });
      expect((await postWebhook(request, body, { appSecret: META.otherAppSecret })).status()).toBe(401);
      expect((await postWebhook(request, body, { signature: "sha256=abc" })).status()).toBe(401);
      expect((await postWebhook(request, body, { signature: null })).status()).toBe(401);
      // The same bytes re-serialized are not what Meta signed.
      const reformatted = JSON.stringify(JSON.parse(body), null, 2);
      expect((await postWebhook(request, reformatted, { signature: signWebhook(body) })).status()).toBe(401);
      await expect(await searchInbox(page, forged)).toHaveCount(0);
    });

    await test.step("[WA-34] a signed body for a number of no channel: 200, and its content is not stored", async () => {
      const lost = uniqueMessage(testInfo, "Mensaje para un número que no es de nadie");
      const response = await postWebhook(request, webhookBody("text", { number: stranger, customer, text: lost }));
      expect(response.status()).toBe(200);
      await expect(await searchInbox(page, lost)).toHaveCount(0);
    });

    await test.step("[WA-33][WA-35][CAN-13][WA-36] the signed message: 200 at once, a new contact with its WhatsApp name and the text in the Bandeja", async () => {
      const text = uniqueMessage(testInfo, "Hola, ¿tenéis hueco mañana por la tarde para un corte?");
      const started = Date.now();
      await deliverWebhook(request, webhookBody("text", { number, customer, text }));
      // [CAN-10] The answer never waits for the AI: well under Meta's 20 s.
      expect(Date.now() - started).toBeLessThan(5_000);
      await openConversationWith(page, text);
      await expect(page.getByRole("main").getByText(customer.name).first()).toBeVisible();
    });
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[WA-41][MED-01][MED-04][MED-08][BAN-06][WA-36] a voice note is downloaded from Meta at once and its transcript shows under the player; an image without url is fetched with GET /{media_id} and only opens with a session", async ({
  page,
  request,
  playwright,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const number = testNumber(testInfo, "WhatsApp archivos");
  const customer = testCustomer(testInfo, "Marta audio");
  let channelId: string | null = null;
  try {
    channelId = await connectWhatsAppNumber(page, number);
    const text = uniqueMessage(testInfo, "Te mando un audio y una foto");
    const caption = uniqueMessage(testInfo, "Quiero este color de pelo");
    await deliverWebhook(request, webhookBody("text", { number, customer, text }));
    // [WA-41] The voice note's url (5 minutes) points at the simulated Meta; the image comes without one.
    await deliverWebhook(request, webhookBody("voice", { number, customer, mediaUrl: "mock" }));
    await deliverWebhook(request, webhookBody("image", { number, customer, text: caption, mediaUrl: "none" }));

    await openConversationWith(page, text);
    const log = conversationLog(page);
    await untilWithQueue(
      request,
      async () => {
        await page.reload();
        return (await log.getByText(SIMULATED_TRANSCRIPT).count()) > 0 && (await log.getByRole("img", { name: "Imagen" }).count()) > 0;
      },
      "the voice note is transcribed and the image downloaded",
      60_000,
    );

    await test.step("[BAN-06][MED-04] player with the transcript underneath", async () => {
      await expect(log.getByLabel("Nota de voz")).toBeVisible();
      await expect(log.getByText("Transcripción", { exact: true })).toBeVisible();
      await expect(log.getByText(SIMULATED_TRANSCRIPT)).toBeVisible();
    });

    await test.step("[WA-41] downloads with the system user's token: the webhook's url, and GET /{media_id} when there is none", async () => {
      const downloads = await mock.requests({ service: "meta", method: "GET", path: "/whatsapp_business/attachments" });
      expect(downloads.map((call) => call.query.mid)).toEqual(expect.arrayContaining(["900000000000001", "900000000000002"]));
      for (const call of downloads) expect(call.headers.authorization).toMatch(/^Bearer EAA/);
      const lookups = await metaCalls(mock, "GET", graphPath("900000000000002"));
      expect(lookups, "the image's url was asked for").toHaveLength(1);
      expect(await metaCalls(mock, "GET", graphPath("900000000000001")), "the voice note came with its url").toHaveLength(0);
    });

    await test.step("[MED-08] the image is served by the app, never Meta's url, and not without a session", async () => {
      const image = log.getByRole("img", { name: "Imagen" }).first();
      await expect(image).toBeVisible();
      await expect(log.getByText(caption, { exact: true })).toBeVisible();
      const src = await image.getAttribute("src");
      expect(src).toMatch(/^\/api\/files\//);
      const withSession = await page.request.get(src ?? "");
      expect(withSession.status()).toBe(200);
      expect(withSession.headers()["content-type"]).toMatch(/^image\//);
      // The `request` fixture carries this file's storageState (the owner's session): a context without cookies is anonymous.
      const anonymousRequest = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        const anonymous = await anonymousRequest.get(src ?? "", { failOnStatusCode: false, maxRedirects: 0 });
        expect(anonymous.status(), "without a session the file is not served").toBeGreaterThanOrEqual(300);
      } finally {
        await anonymousRequest.dispose();
      }
    });
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[WA-38][WA-47][AJU-09][BAN-05] statuses only move forward and the first pricing gives the estimated cost with the rate of Ajustes › WhatsApp", async ({ page, request, mock }, testInfo) => {
  test.setTimeout(180_000);
  const number = testNumber(testInfo, "WhatsApp estados");
  // A Portuguese customer: the market comes from the phone's prefix ([WA-47]).
  const customer = testCustomer(testInfo, "João estados", { country: "PT" });
  const wamid = testWamid(testInfo, "respuesta");
  let channelId: string | null = null;
  try {
    // [AJU-09] The rate is the business's own, per market and category; never in the code.
    await saveWhatsAppRate(page, { country: "PT", category: "service", price: "0,0087" });
    channelId = await connectWhatsAppNumber(page, number);

    const text = uniqueMessage(testInfo, "Olá, ¿habláis portugués?");
    await deliverWebhook(request, webhookBody("text", { number, customer, text }));
    await openConversationWith(page, text);
    const reply = uniqueMessage(testInfo, "Sí, te atendemos en español o portugués");
    await nextSendGetsWamid(mock, number, wamid, { to: e164(customer) });
    await replyAsPerson(page, reply);
    await expect.poll(async () => (await sentMessages(mock, number)).map((sent) => sent.text?.body)).toEqual([reply]);

    const log = conversationLog(page);
    await test.step("[WA-38] «enviado», then «leído»; a «entregado» that arrives late changes nothing", async () => {
      await deliverWebhook(request, webhookBody("status-sent", { number, customer, statusOf: wamid }));
      await expect(log).toContainText("Enviado", { timeout: 15_000 });
      await deliverWebhook(request, webhookBody("status-read", { number, customer, statusOf: wamid }));
      await expect(log).toContainText("Leído", { timeout: 15_000 });
      await deliverWebhook(request, webhookBody("status-delivered-regular", { number, customer, statusOf: wamid }));
      await page.reload();
      await expect(log).toContainText("Leído");
      await expect(log).not.toContainText("Entregado");
    });

    await test.step("[WA-47] `regular` × the rate of Portugal for «service», from the first pricing", async () => {
      await expect(log).toContainText(/0,0087\s*US\$ estimado/, { timeout: 15_000 });
      await expect(log).toContainText("Servicio");
    });
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[WA-39][CAN-13] a customer with only a BSUID becomes a contact and a person's reply goes to `recipient` = BSUID, never to a phone", async ({ page, request, mock }, testInfo) => {
  test.setTimeout(150_000);
  const number = testNumber(testInfo, "WhatsApp BSUID");
  const customer = testCustomer(testInfo, "Lucía usuario", { withPhone: false });
  let channelId: string | null = null;
  try {
    channelId = await connectWhatsAppNumber(page, number);
    const text = uniqueMessage(testInfo, "Buenas, ¿cuánto cuesta un tinte?");
    await deliverWebhook(request, webhookBody("bsuid-only", { number, customer, text }));
    await openConversationWith(page, text);
    await expect(page.getByRole("main").getByText(customer.name).first()).toBeVisible();

    const reply = uniqueMessage(testInfo, "El tinte cuesta desde 35 €");
    await replyAsPerson(page, reply);
    await expect.poll(async () => (await sentMessages(mock, number)).length).toBe(1);
    const [sent] = await sentMessages(mock, number);
    expect(sent).toMatchObject({ recipient: customer.bsuid, type: "text", text: { body: reply } });
    expect(sent.to).toBeUndefined();
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[WA-50][CAN-12][CAN-13] a BSUID change keeps the same contact and conversation, leaves a system note and the AI does not answer it", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(240_000);
  expect(openRouterKey).toBeTruthy();
  const number = testNumber(testInfo, "WhatsApp cambio BSUID");
  const before = testCustomer(testInfo, "Lucía cambia", { withPhone: false });
  const after = { ...before, bsuid: testCustomer(testInfo, "Lucía cambia (nuevo)", { withPhone: false }).bsuid };
  const agentName = uniqueName(testInfo, "Agente BSUID");
  let channelId: string | null = null;
  try {
    await createNamedAgent(page, agentName);
    // Test mode off: this number of its own only hears from this customer.
    channelId = await connectWhatsAppNumber(page, number, { agentName, aiEnabled: true, testMode: false });

    const first = uniqueMessage(testInfo, "Hola, soy Lucía");
    await deliverWebhook(request, webhookBody("bsuid-only", { number, customer: before, text: first }));
    const conversationId = await openConversationWith(page, first);
    await untilWithQueue(request, async () => (await chatRequestsFor(mock, conversationId)).length === 1, "the AI answers the first message");

    await test.step("[WA-50] the identity change: a system note in the same conversation, and no AI turn", async () => {
      await deliverWebhook(request, webhookBody("system-user-changed-user-id", { number, customer: after, previousBsuid: before.bsuid }));
      await page.reload();
      await expect(conversationLog(page).getByText(BSUID_CHANGED_NOTE)).toBeVisible({ timeout: 15_000 });
      // [BAN-05] The note is the system's, not a message of the customer.
      await expect(systemMessage(page, BSUID_CHANGED_NOTE)).toHaveCount(1);
      await holdsFor(request, async () => (await chatRequestsFor(mock, conversationId)).length, 1, "no AI reply to the system note");
    });

    await test.step("[CAN-13] the next message from the new BSUID lands in the same conversation, answered to the new BSUID", async () => {
      const second = uniqueMessage(testInfo, "Sigo siendo yo, con otro usuario");
      await deliverWebhook(request, webhookBody("bsuid-only", { number, customer: after, text: second }));
      expect(await openConversationWith(page, second)).toBe(conversationId);
      await expect(customerMessage(page, first)).toBeVisible();
      await expect(await searchInbox(page, before.name)).toHaveCount(1);
      await untilWithQueue(request, async () => (await chatRequestsFor(mock, conversationId)).length === 2, "the AI answers the new message");
      await expect.poll(async () => (await sentMessages(mock, number)).map((sent) => sent.recipient)).toEqual([before.bsuid, after.bsuid]);
    });
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[MOT-01][WA-36][BAN-05] a text followed at once by a type the AI does not answer gets one single reply; the notice is a system message", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const number = testNumber(testInfo, "WhatsApp no admitido");
  const customer = testCustomer(testInfo, "Ana encuesta");
  const agentName = uniqueName(testInfo, "Agente no admitido");
  let channelId: string | null = null;
  try {
    await createNamedAgent(page, agentName);
    channelId = await connectWhatsAppNumber(page, number, { agentName, aiEnabled: true, testMode: false });

    // Both arrive before the reply's wait is over: the notice neither holds the reply back nor is a turn of the customer.
    const text = uniqueMessage(testInfo, "¿Tenéis hueco mañana por la tarde para un corte?");
    await deliverWebhook(request, webhookBody("text", { number, customer, text }));
    await deliverWebhook(request, webhookBody("unsupported", { number, customer }));
    const conversationId = await openConversationWith(page, text);
    await untilWithQueue(request, async () => (await sentMessages(mock, number)).length === 1, "the AI answers the text");
    await holdsFor(request, async () => (await sentMessages(mock, number)).length, 1, "one reply, never two");
    const calls = await chatRequestsFor(mock, conversationId);
    expect(calls).toHaveLength(1);
    const prompt = calls[0].body.messages.map((message) => messageText(message)).join("\n");
    expect(prompt).toContain(text);
    expect(prompt).not.toContain(UNSUPPORTED_NOTE);

    await page.reload();
    await expect(systemMessage(page, new RegExp(UNSUPPORTED_NOTE))).toHaveCount(1);
    await expect(anyAiAuthor(page).first()).toBeVisible();
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[CAN-11][WA-35][WA-44][WA-45] the same message delivered twice is stored once and answered once, with «escribiendo…» first", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const number = testNumber(testInfo, "WhatsApp duplicado");
  const customer = testCustomer(testInfo, "Ana duplicada");
  const agentName = uniqueName(testInfo, "Agente duplicado");
  const wamid = testWamid(testInfo, "duplicado");
  let channelId: string | null = null;
  try {
    await createNamedAgent(page, agentName);
    channelId = await connectWhatsAppNumber(page, number, { agentName, aiEnabled: true, allowlist: [e164(customer)] });

    const text = uniqueMessage(testInfo, "Hola, ¿tenéis hueco mañana por la tarde para un corte?");
    // Meta retries and sometimes duplicates: two POSTs, same wamid.
    for (const body of duplicateDeliveries({ number, customer, text, wamid })) await deliverWebhook(request, body);

    const conversationId = await openConversationWith(page, text);
    await expect(conversationLog(page).getByText(text, { exact: true })).toHaveCount(1);
    await untilWithQueue(request, async () => (await sentMessages(mock, number)).length >= 1, "the AI's reply reaches Meta");
    await holdsFor(request, async () => (await sentMessages(mock, number)).length, 1, "one reply, never two");
    expect(await chatRequestsFor(mock, conversationId)).toHaveLength(1);
    const [sent] = await sentMessages(mock, number);
    expect(sent).toMatchObject({ to: e164(customer), type: "text" });
    expect(sent.text?.body).toContain(text);
    expect(messageText((await chatRequestsFor(mock, conversationId))[0].body.messages[0])).toContain("WhatsApp");

    // [WA-45] «Leído» with «escribiendo…» on the customer's message while the AI prepared the reply.
    const receipts = (await metaCalls(mock, "POST", graphPath(number.phoneNumberId, "messages"))).map((call) => call.body);
    expect(receipts).toContainEqual(expect.objectContaining({ status: "read", message_id: wamid, typing_indicator: { type: "text" } }));
    await page.reload();
    await expect(anyAiAuthor(page).first()).toBeVisible();
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});
