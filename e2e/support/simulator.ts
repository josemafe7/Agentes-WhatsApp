// Ajustes › Diagnóstico › Simulador de canales ([AJU-11]–[AJU-13]) as the owner uses it. Locators follow
// docs/pantallas.md «Ajustes» (Simulador de canales):
//   /ajustes/diagnostico/simulador  «Canal» (a select of the channels), the contact — a new one, with «Nombre» and its
//   identifier in that channel («Teléfono» in WhatsApp), or «Contacto» → «Nuevo contacto» first when it offers the
//   existing ones —, «Tipo» (Texto, Audio, Imagen o Documento), «Mensaje» and «Enviar»; then «Ver conversación».
import { expect, type Page } from "@playwright/test";
import { chooseOption, type OptionWanted } from "./forms";
import { conversationIdFromUrl, CONVERSATION_URL } from "./inbox";
import { clickAndWaitForPost } from "./ui";

export const SIMULATOR_PATH = "/ajustes/diagnostico/simulador";

/** The demo WhatsApp channel of the seed, or else any WhatsApp channel. */
export const DEMO_WHATSAPP: OptionWanted = [/WhatsApp.*demo|demo.*WhatsApp/i, /WhatsApp/i];

export type SimulatedText = { channel: OptionWanted; contactName: string; phone: string; text: string };

/** Sends a text message as a new contact through the simulator; returns the channel it chose. */
export async function simulateTextMessage(page: Page, message: SimulatedText): Promise<string> {
  await page.goto(SIMULATOR_PATH);
  const main = page.getByRole("main");
  const channel = await chooseOption(page, main.getByRole("combobox", { name: /^Canal/ }), message.channel);

  const contactPicker = main.getByRole("combobox", { name: /^Contacto/ }).first();
  if (await contactPicker.isVisible()) await chooseOption(page, contactPicker, [/nuevo/i]);
  const name = main.getByRole("textbox", { name: /^Nombre/ }).first();
  if (await name.isVisible()) await name.fill(message.contactName);
  const identifier = main.getByRole("textbox", { name: /Tel[eé]fono|N[uú]mero|Identificador/ }).first();
  if (await identifier.isVisible()) await identifier.fill(message.phone);

  const textType = main.getByRole("radio", { name: "Texto", exact: true });
  const typePicker = main.getByRole("combobox", { name: /^Tipo/ }).first();
  if (await textType.isVisible()) await textType.check();
  else if (await typePicker.isVisible()) await chooseOption(page, typePicker, "Texto");

  await main.getByRole("textbox", { name: /^(Mensaje|Texto del mensaje)/ }).fill(message.text);
  await clickAndWaitForPost(page, main.getByRole("button", { name: /^Enviar/ }));
  return channel;
}

/** «Ver conversación» after a simulated message: opens it in the Bandeja and returns its id. */
export async function openSimulatedConversation(page: Page): Promise<string> {
  const view = page.getByRole("main").getByRole("link", { name: /Ver conversación/ });
  await expect(view, "«Ver conversación» once the message is in").toBeVisible();
  await view.click();
  await expect(page).toHaveURL(CONVERSATION_URL);
  return conversationIdFromUrl(page.url());
}
