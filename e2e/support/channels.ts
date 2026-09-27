// Canales as the owner uses them ([CAN-*], [WEB-01], [WEB-02]). Locators follow docs/pantallas.md «Canales», DESIGN.md
// («Tarjeta de canal», confirmations with the exact verb) and src/app/(app)/canales, so a change of wording is fixed here:
//   /canales/nuevo/web       «Nombre», «Agente activo» (combobox), «IA del canal» and the look of the chat; «Crear chat
//                            web» → «Tu chat web está listo» with its code to paste, which carries data-channel="<id>".
//                            «Imágenes» (switch) lets visitors and the team send photos ([WEB-07], [BAN-14]).
//   /canales                 one card per channel (a list item headed by the channel's name) with its type, «Agente
//                            activo» (combobox) and «IA del canal» (switch) ([CAN-01], [CAN-04]); replacing the agent
//                            asks first in an alertdialog that names the agent it replaces, with «Sustituir» ([AGE-10]).
//   /canales/[id]/apariencia «Apariencia y código»: the code to paste (<script src=".../widget.js" data-channel="<id>">)
//                            and the link «Abrir en /widget-demo» that opens this chat in the demo page.
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createNamedAgent } from "./agents";
import { DEMO_URL } from "./env";
import { chooseOption, chosenLabel } from "./forms";
import { uniqueName } from "./names";
import { clickAndWaitForPost } from "./ui";

export const CHANNELS_PATH = "/canales";
export const NEW_WEBCHAT_PATH = "/canales/nuevo/web";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CHANNEL_URL = new RegExp(`/canales/(${UUID})(?:[/?#]|$)`);
const CODE_CHANNEL_ID = new RegExp(`data-channel="(${UUID})"`, "g");
const ACTIVE_AGENT = /^Agente activo/;
/** The confirmation of a replacement («… sustituirá a …»). */
export const REPLACE_AGENT = /^Sustituir$/;

export function appearancePath(channelId: string): string {
  return `${CHANNELS_PATH}/${channelId}/apariencia`;
}

/** What the page shows as text plus the values of its fields: the code to paste may be in either ([WEB-01]). */
export async function textAndFieldsOf(page: Page): Promise<string> {
  const text = await page.locator("body").innerText();
  const values = await page
    .locator("textarea, input")
    .evaluateAll((fields) => fields.map((field) => (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : "")));
  return [text, ...values].join("\n");
}

/** Channel ids in the code to paste shown on the page. */
export async function channelIdsInCode(page: Page): Promise<string[]> {
  return [...(await textAndFieldsOf(page)).matchAll(CODE_CHANNEL_ID)].map((match) => match[1]);
}

/**
 * Canales › Añadir › Chat web with a name and, optionally, its active agent (without one the AI does not answer and
 * messages wait for a person, [CAN-03]); returns the new channel's id.
 */
export async function createWebchatChannel(page: Page, name: string, options: { agentName?: string; images?: boolean } = {}): Promise<string> {
  await page.goto(NEW_WEBCHAT_PATH);
  const main = page.getByRole("main");
  await main.getByLabel("Nombre", { exact: true }).fill(name);
  if (options.agentName) await chooseOption(page, main.getByRole("combobox", { name: ACTIVE_AGENT }), options.agentName);
  // «Imágenes» of the look ([WEB-07]): off by default.
  if (options.images) await main.getByRole("switch", { name: "Imágenes" }).click();
  await clickAndWaitForPost(page, main.getByRole("button", { name: "Crear chat web" }));
  const found: { id: string | null } = { id: null };
  await expect
    .poll(
      async () => {
        found.id = CHANNEL_URL.exec(page.url())?.[1] ?? (await channelIdsInCode(page))[0] ?? null;
        return found.id !== null;
      },
      { message: `the new web chat «${name}» shows its code with its id` },
    )
    .toBe(true);
  if (!found.id) throw new Error(`No id for the web chat «${name}»`);
  return found.id;
}

export type WebchatSetup = { agentId: string; agentName: string; channelId: string; channelName: string };

/** An agent of the test's own (from the demo template) and a new web chat where it is the active agent. */
export async function setUpWebchat(page: Page, testInfo: TestInfo, agentLabel: string): Promise<WebchatSetup> {
  const agentName = uniqueName(testInfo, agentLabel);
  const agentId = await createNamedAgent(page, agentName);
  const channelName = uniqueName(testInfo, `Chat web de ${agentLabel}`);
  const channelId = await createWebchatChannel(page, channelName, { agentName });
  return { agentId, agentName, channelId, channelName };
}

/** Every card of /canales. */
export function channelCards(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading") });
}

/** The card of a channel in /canales (names in the tests are unique). */
export function channelCard(page: Page, name: string): Locator {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

/** «Agente activo» of a card ([CAN-04]). */
export function activeAgentPicker(card: Locator): Locator {
  return card.getByRole("combobox", { name: ACTIVE_AGENT });
}

/** «IA del canal» of a card ([CAN-04]). */
export function channelAiSwitch(card: Locator): Locator {
  return card.getByRole("switch", { name: /\bIA\b/ }).first();
}

/** The agent a card shows as active. */
export async function activeAgentOnCard(page: Page, channelName: string): Promise<string> {
  return chosenLabel(activeAgentPicker(channelCard(page, channelName)));
}

/** Picks another agent in the card's «Agente activo»; a replacement then asks for confirmation (the test answers it). */
export async function pickActiveAgentOnCard(page: Page, channelName: string, agentName: string): Promise<void> {
  await page.goto(CHANNELS_PATH);
  await chooseOption(page, activeAgentPicker(channelCard(page, channelName)), agentName);
}

/** Where «Abrir en /widget-demo» of the channel's «Apariencia y código» leads (path and query). Leaves the page there. */
export async function widgetDemoPath(page: Page, channelId: string): Promise<string> {
  await page.goto(appearancePath(channelId));
  const link = page.getByRole("main").getByRole("link", { name: /widget-demo/i }).first();
  await expect(link, "«Abrir en /widget-demo» in Apariencia y código").toBeVisible();
  const href = await link.getAttribute("href");
  if (!href) throw new Error(`«Abrir en /widget-demo» of ${channelId} has no address`);
  const url = new URL(href, DEMO_URL);
  expect(url.origin, "the demo page is part of the app").toBe(new URL(DEMO_URL).origin);
  expect(url.pathname).toMatch(/^\/widget-demo(\/|$)/);
  return `${url.pathname}${url.search}`;
}
