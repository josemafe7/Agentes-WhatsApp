// Telegram from end to end ([TG-01]–[TG-11]) against the simulated Telegram: the wizard connects a bot with its token
// (here the app has no public address, so it works in «modo local»: it asks Telegram for the messages itself), a
// customer's «hola» shows in the wizard, the active agent answers with ONE message through the bot, and «Desconectar»
// removes the bot from this installation. Each test connects a bot of its own and leaves it disconnected.
import { createNamedAgent, uniqueAgentName } from "../support/agents";
import { authStatePath } from "../support/app";
import { channelCard, CHANNELS_PATH } from "../support/channels";
import { untilWithQueue } from "../support/engine";
import { DEMO_URL } from "../support/env";
import { conversationLog, customerMessage, openConversationWith } from "../support/inbox";
import { uniqueMessage, uniqueName } from "../support/names";
import {
  botCalls,
  connectBot,
  connectedHeading,
  customerWrites,
  disconnectBot,
  disconnectBotQuietly,
  fillBotForm,
  NEW_TELEGRAM_PATH,
  pressConnect,
  revokedToken,
  sentByBot,
  telegramPanelPath,
  testBot,
  testMessageArrived,
  testTelegramUser,
} from "../support/telegram";
import { expect, test } from "../support/test";
import { escapeRegExp } from "../support/ui";
import { expectChannelState, expectLight } from "../support/whatsapp";

test.use({ storageState: authStatePath("owner") });

const CHANNEL_PANEL_URL = /\/canales\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

test("[TG-01][TG-03][TG-06][TG-07][TG-09][TG-10] the wizard connects a bot by its token, the customer's message arrives and the agent answers once through Telegram", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(openRouterKey).toBeTruthy();
  const agentName = uniqueAgentName(testInfo, "Agente Telegram");
  await createNamedAgent(page, agentName);
  const bot = testBot(testInfo, uniqueName(testInfo, "Telegram e2e"));
  const customer = testTelegramUser(testInfo, "Carmen");
  let channelId: string | null = null;
  try {
    // [TG-01] How to create the bot is right there, with @BotFather's QR code and link.
    await page.goto(NEW_TELEGRAM_PATH);
    await expect(page.getByRole("img", { name: /Código QR para abrir @BotFather/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Abrir @BotFather/ })).toHaveAttribute("href", "https://t.me/BotFather");
    // [TG-06] No public address here: the screen says it will work in «modo local».
    await expect(page.getByText(/funcionará en «modo local»/)).toBeVisible();

    await fillBotForm(page, bot, { agentName });
    await pressConnect(page);
    await expect(connectedHeading(page, bot)).toBeVisible({ timeout: 20_000 });
    // [TG-07] The bot's link and its QR code, to try it and to give it to customers.
    await expect(page.getByRole("link", { name: new RegExp(escapeRegExp(bot.link)) })).toBeVisible();
    await expect(page.getByRole("img", { name: new RegExp(`Código QR para abrir el chat con @${bot.username}`) })).toBeVisible();
    // [TG-01][SEG-02] The token is nowhere on the screen once sent.
    expect(await page.content()).not.toContain(bot.token);
    // [TG-06] Without a public address the bot has no webhook: the app asks for the messages.
    expect(await botCalls(mock, bot, "setWebhook")).toHaveLength(0);
    expect((await botCalls(mock, bot, "deleteWebhook")).length).toBeGreaterThan(0);

    // [TG-10] Opening the chat sends «/start» by itself; then the customer writes.
    const text = uniqueMessage(testInfo, "Hola, ¿abrís los sábados?");
    await customerWrites(request, bot, customer, text);
    await untilWithQueue(request, async () => (await testMessageArrived(page).count()) > 0, "the customer's message shows in the wizard");
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByText(new RegExp(`«${escapeRegExp(agentName)}» le contestará`))).toBeVisible();

    // [TG-03][TG-09] The active agent answers with exactly one message, through the bot, in that customer's chat.
    const reply = new RegExp(`Te escribo por Telegram\\. Me has escrito: «${escapeRegExp(text)}»`);
    await untilWithQueue(request, async () => (await sentByBot(mock, bot)).some((message) => reply.test(message.text)), "the agent's reply went out through Telegram");
    const sent = await sentByBot(mock, bot);
    expect(sent).toHaveLength(1);
    expect(String(sent[0].chat_id)).toBe(String(customer.id));

    // The conversation is in the Bandeja, with the customer's Telegram name and the reply.
    await openConversationWith(page, text);
    await expect(customerMessage(page, text)).toBeVisible();
    await expect(conversationLog(page).getByText(reply)).toHaveCount(1);

    // [TG-08] The panel: the lights, the local mode and the link for customers.
    await page.goto(CHANNELS_PATH);
    await channelCard(page, bot.channelName).getByRole("link", { name: bot.channelName }).click();
    await expect(page).toHaveURL(CHANNEL_PANEL_URL);
    channelId = CHANNEL_PANEL_URL.exec(page.url())?.[1] ?? null;
    await expectLight(page, "Token", "ok");
    await expectLight(page, "Recepción", "ok");
    await expect(page.getByRole("heading", { name: "Enlace para tus clientes" })).toBeVisible();
    await expect(page.getByText("Modo local", { exact: true })).toBeVisible();

    // [TG-02] The bot's own webhook address refuses anything without its secret.
    const refused = await request.post(`${DEMO_URL}/api/webhooks/telegram/${channelId}`, { data: { update_id: 1, message: {} }, failOnStatusCode: false });
    expect(refused.status()).toBe(401);

    // [TG-04] «Desconectar»: Telegram is told, the token is deleted and the channel keeps its history.
    await disconnectBot(page, channelId ?? "", bot.channelName);
    await expect(page.getByText("Este bot está desconectado")).toBeVisible();
    await expectChannelState(page, bot.channelName, /Desactivado/);
    channelId = null;
  } finally {
    await disconnectBotQuietly(page, channelId, bot.channelName);
  }
});

test("[TG-01][TG-05] a token Telegram refuses stores nothing and says why; the same bot is not connected twice", async ({ page, mock }, testInfo) => {
  test.setTimeout(120_000);
  expect(mock).toBeTruthy();
  const bot = testBot(testInfo, uniqueName(testInfo, "Telegram repetido"));
  let channelId: string | null = null;
  try {
    // A token @BotFather revoked: Telegram's refusal, in Spanish, next to the field.
    await fillBotForm(page, bot, { token: revokedToken(bot) });
    await pressConnect(page);
    await expect(page.getByText(/El token del bot no es válido o se ha revocado/)).toBeVisible();
    // Something that is not a token never reaches Telegram.
    await fillBotForm(page, bot, { token: "esto no es un token" });
    await pressConnect(page);
    await expect(page.getByText(/Eso no parece un token de bot/)).toBeVisible();
    await expectNoChannel(page, bot.channelName);

    channelId = await connectBot(page, bot);
    await expect(page.getByText(`@${bot.username}`).first()).toBeVisible();

    // [TG-05] The same bot again, under another name: refused.
    await fillBotForm(page, { ...bot, channelName: `${bot.channelName} bis` });
    await pressConnect(page);
    await expect(page.getByText("Este bot ya está conectado en otro canal de la instalación.")).toBeVisible();
    await expectNoChannel(page, `${bot.channelName} bis`);
  } finally {
    await disconnectBotQuietly(page, channelId, bot.channelName);
  }
});

async function expectNoChannel(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.goto("/canales");
  await expect(page.getByRole("main").getByText(name, { exact: true })).toHaveCount(0);
}

test("[PER-04] only owner and admin reach the Telegram wizard", async ({ browser }, testInfo) => {
  for (const role of ["supervisor", "agent", "viewer"] as const) {
    const context = await browser.newContext({ storageState: authStatePath(role), baseURL: testInfo.project.use.baseURL });
    const page = await context.newPage();
    await page.goto(NEW_TELEGRAM_PATH);
    await expect(page.getByText("No tienes permiso para ver esta sección")).toBeVisible();
    await expect(page.getByLabel("Token del bot")).toHaveCount(0);
    await context.close();
  }
  expect(telegramPanelPath("x")).toBe("/canales/x");
});
