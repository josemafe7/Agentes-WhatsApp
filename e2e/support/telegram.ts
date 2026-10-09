// Telegram as the team uses it ([TG-*]) and the simulated Telegram of the e2e run (e2e/mocks/routes/telegram.mjs).
// Locators follow docs/pantallas.md («Asistente de Telegram», «Panel del canal») and
// src/app/(app)/canales/nuevo/telegram and src/app/(app)/canales/[id]/_telegram, so a change of wording is fixed here:
//   /canales/nuevo/telegram   Paso 1: «Token del bot», «Nombre del canal», «Agente activo», «IA del canal» and «Conectar
//                             bot»; at the side, how to create the bot, with the QR code and the link of @BotFather.
//                             Paso 2: «… está conectado», the bot's link and QR code, and «Esperando tu «hola»…» that
//                             turns into «Ha llegado tu mensaje»; «Ir al panel del canal».
//   /canales/[id]             the Telegram panel: «Bot de Telegram», a traffic light per check («Token», «Recepción»,
//                             «Último mensaje»), «Revalidar», «Cambiar token», «Desconectar» (name to confirm) and
//                             «Enlace para tus clientes».
// Each test connects a bot of its own: any token «<digits>:<letters>» is a bot for the simulated Telegram.
import { createHash } from "node:crypto";
import { expect, type APIRequestContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { CHANNELS_PATH } from "./channels";
import { MOCK_URL, RUN_ID } from "./env";
import { chooseOption } from "./forms";
import type { MockClient, MockRecordedRequest } from "./mock-client";
import { clickAndWaitForPost } from "./ui";

export const NEW_TELEGRAM_PATH = "/canales/nuevo/telegram";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CHANNEL_PANEL_URL = new RegExp(`/canales/(${UUID})(?:[/?#]|$)`);

export type TestBot = { id: string; token: string; username: string; link: string; channelName: string };
export type TestTelegramUser = { id: number; first_name: string; last_name: string };

function digits(testInfo: TestInfo, label: string, length: number): string {
  const hash = createHash("sha256").update(`${RUN_ID}:${testInfo.testId}:${testInfo.retry}:${label}`).digest("hex");
  return String(parseInt(hash.slice(0, 12), 16) % 10 ** length).padStart(length, "1");
}

/** Tokens are put together at runtime: no literal in the repository may look like a real key to secret scanners. */
const tokenOf = (botId: string, secret = "PRUEBAE2E0") => [botId, secret.repeat(4).slice(0, 35)].join(":");

/** A bot only this test uses. */
export function testBot(testInfo: TestInfo, channelName: string): TestBot {
  const id = `7${digits(testInfo, `bot:${channelName}`, 9)}`;
  const username = `prueba_${id}_bot`;
  return { id, token: tokenOf(id), username, link: `https://t.me/${username}`, channelName };
}

/** The token of the same bot once @BotFather revoked it. */
export const revokedToken = (bot: TestBot) => tokenOf(bot.id, "REVOCADO00");

/** A Telegram user only this test uses. */
export function testTelegramUser(testInfo: TestInfo, firstName: string): TestTelegramUser {
  return { id: Number(`5${digits(testInfo, `user:${firstName}`, 9)}`), first_name: firstName, last_name: "Pruebas" };
}

function main(page: Page): Locator {
  return page.getByRole("main");
}

export function telegramPanelPath(channelId: string): string {
  return `${CHANNELS_PATH}/${channelId}`;
}

/** Paso 1 filled in: token, name and, if given, the agent that answers. */
export async function fillBotForm(page: Page, bot: TestBot, options: { token?: string; agentName?: string } = {}): Promise<void> {
  await page.goto(NEW_TELEGRAM_PATH);
  const form = main(page);
  await form.getByLabel("Token del bot").fill(options.token ?? bot.token);
  await form.getByLabel("Nombre del canal").fill(bot.channelName);
  if (options.agentName) await chooseOption(page, form.getByRole("combobox", { name: "Agente activo" }), options.agentName);
}

export async function pressConnect(page: Page): Promise<void> {
  await clickAndWaitForPost(page, main(page).getByRole("button", { name: "Conectar bot" }));
}

/** «… está conectado»: the heading of Paso 2. */
export function connectedHeading(page: Page, bot: TestBot): Locator {
  return main(page).getByRole("heading", { name: new RegExp(`@${bot.username}\\)? está conectado$`) });
}

/** «Ha llegado tu mensaje» of Paso 2. */
export function testMessageArrived(page: Page): Locator {
  return main(page).getByText("Ha llegado tu mensaje");
}

/** Connects the bot through the wizard and opens its panel; returns the channel's id. */
export async function connectBot(page: Page, bot: TestBot, options: { agentName?: string } = {}): Promise<string> {
  await fillBotForm(page, bot, options);
  await pressConnect(page);
  await expect(connectedHeading(page, bot)).toBeVisible({ timeout: 20_000 });
  await main(page).getByRole("link", { name: "Ir al panel del canal" }).click();
  await expect(page).toHaveURL(CHANNEL_PANEL_URL);
  const id = CHANNEL_PANEL_URL.exec(page.url())?.[1];
  if (!id) throw new Error(`No channel id in ${page.url()}`);
  return id;
}

/** «Desconectar» ([TG-04]): writes the channel's name to confirm. */
export async function disconnectBot(page: Page, channelId: string, channelName: string): Promise<void> {
  await page.goto(telegramPanelPath(channelId));
  await main(page).getByRole("button", { name: "Desconectar", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("textbox", { name: /^Escribe .* para confirmar/ }).fill(channelName);
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Desconectar", exact: true }));
  await expect(dialog).toHaveCount(0);
}

/** Best effort, so a failed test never leaves its bot being asked for updates. */
export async function disconnectBotQuietly(page: Page, channelId: string | null, channelName: string): Promise<void> {
  if (!channelId) return;
  try {
    await page.goto(telegramPanelPath(channelId));
    if (await main(page).getByRole("button", { name: "Desconectar", exact: true }).isVisible()) await disconnectBot(page, channelId, channelName);
  } catch {
    // The next test uses its own bot anyway.
  }
}

// ─── The simulated Telegram ─────────────────────────────────────────────────────────────────────────────

/** What a customer does in Telegram: writes to the bot. The app gets it at its next poll (no public address in e2e). */
export async function customerWrites(request: APIRequestContext, bot: TestBot, from: TestTelegramUser, text: string): Promise<void> {
  const response = await request.post(`${MOCK_URL}/telegram/dashboard/bots/${bot.id}/messages`, { data: { from, text } });
  if (!response.ok()) throw new Error(`The simulated Telegram refused the message: ${response.status()}`);
}

/** The calls of a Bot API method the app made with this bot's token. */
export async function botCalls(mock: MockClient, bot: TestBot, method: string, token: string = bot.token): Promise<MockRecordedRequest[]> {
  return mock.requests({ service: "telegram", method: "POST", path: `/bot${token}/${method}` });
}

/** The messages the app sent through the bot: `{ chat_id, text }`. */
export async function sentByBot(mock: MockClient, bot: TestBot): Promise<{ chat_id: string; text: string }[]> {
  return (await botCalls(mock, bot, "sendMessage")).map((call) => call.body as { chat_id: string; text: string });
}
