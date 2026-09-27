// Search without accents or case ([CTO-01], [BAN-02]): typing «jose» finds «José» in Contactos and in the Bandeja. The
// contact arrives as a real one would, through the simulator of the demo WhatsApp (docs/pantallas.md «Simulador»).
import { authStatePath } from "../support/app";
import { searchInbox } from "../support/inbox";
import { uniqueMessage, uniquePhone, uniqueRef } from "../support/names";
import { DEMO_WHATSAPP, simulateTextMessage } from "../support/simulator";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

test("[CTO-01][BAN-02] «jose» finds «José Núñez» in Contactos and in the Bandeja", async ({ page }, testInfo) => {
  const ref = uniqueRef(testInfo, "contacto");
  const name = `José Núñez ${ref}`;
  await simulateTextMessage(page, { channel: DEMO_WHATSAPP, contactName: name, phone: uniquePhone(testInfo), text: uniqueMessage(testInfo, "Hola, quería información") });

  await test.step("[CTO-01] Contactos: without accents and in lower case", async () => {
    await page.goto(`/contactos?buscar=${encodeURIComponent(`jose nunez ${ref}`)}`);
    await expect(page.getByRole("main").getByRole("link", { name, exact: true }).first()).toBeVisible();
    await page.goto(`/contactos?buscar=${encodeURIComponent(`JOSÉ NÚÑEZ ${ref}`)}`);
    await expect(page.getByRole("main").getByRole("link", { name, exact: true }).first()).toBeVisible();
  });

  await test.step("[BAN-02] Bandeja: the conversation of «José» by «jose»", async () => {
    await expect(await searchInbox(page, `jose nunez ${ref}`)).toHaveCount(1);
  });
});
