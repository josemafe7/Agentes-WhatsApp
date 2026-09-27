// The channel simulator never touches a real customer ([AJU-13]): it writes only as its own customers, each with their
// own contact and conversation. After a message as a new customer, the picker of «Un contacto que ya existe» offers
// that customer and never the demo's real ones (Cristina Herrero writes to the demo WhatsApp in the seed).
import { authStatePath } from "../support/app";
import { uniqueName, uniquePhone } from "../support/names";
import { DEMO_WHATSAPP, simulateTextMessage } from "../support/simulator";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

/** A customer of the demo seed with a WhatsApp conversation (seed/steps/conversations.ts). */
const DEMO_CUSTOMER = "Cristina Herrero";

test("[AJU-13][AJU-12] the simulator offers only its own customers, never a real one", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const contactName = uniqueName(testInfo, "Cliente del simulador");
  await simulateTextMessage(page, { channel: DEMO_WHATSAPP, contactName, phone: uniquePhone(testInfo), text: "Hola, ¿abrís el sábado?" });

  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Un contacto que ya existe" }).check();
  await main.getByRole("combobox", { name: /^Contacto/ }).click();
  const options = page.getByRole("option");
  await expect(options.filter({ hasText: contactName })).toHaveCount(1);
  await expect(options.filter({ hasText: DEMO_CUSTOMER })).toHaveCount(0);
  await page.keyboard.press("Escape");
});
