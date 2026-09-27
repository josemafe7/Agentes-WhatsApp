// The data rights of a contact on screen (docs/pantallas.md «Contactos» and «Ficha del contacto»): export everything of a
// contact and the list ([CTO-06]), erase a contact typing its name ([CTO-07]), suggest and merge duplicates ([CTO-04],
// [CTO-05]) and lift a baja when the customer asks ([CTO-08]); each only for the roles of «Quién puede hacer qué»
// ([PER-01]). The server checks are proved in Vitest (src/data/contacts-*.test.ts); here it is what a person sees.
import fs from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { authStatePath, newPersonContext, triggerTick } from "../support/app";
import { CONVERSATION_URL, customerMessage } from "../support/inbox";
import { uniqueMessage, uniquePhone, uniqueRef } from "../support/names";
import { DEMO_WHATSAPP, simulateTextMessage } from "../support/simulator";
import { clientIpFor, expect, test } from "../support/test";
import { clickAndWaitForPost, expectRefused } from "../support/ui";

test.use({ storageState: authStatePath("owner") });

const CONTACTS_PATH = "/contactos";
const CARD_URL = /\/contactos\/[0-9a-f-]{36}$/;

const main = (page: Page) => page.getByRole("main");

/** «Nuevo contacto» by hand; leaves the page on its card. */
async function createContactByHand(page: Page, contact: { name: string; email?: string }): Promise<void> {
  await page.goto(CONTACTS_PATH);
  await main(page).getByRole("button", { name: "Nuevo contacto" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /^Nombre/ }).fill(contact.name);
  if (contact.email) await dialog.getByRole("textbox", { name: /^Email/ }).fill(contact.email);
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Crear contacto" }));
  await expect(page).toHaveURL(CARD_URL);
  await expect(page.getByRole("heading", { level: 1, name: contact.name })).toBeVisible();
}

/** The contacts of the list for a search (the table's name links). */
async function searchContacts(page: Page, search: string): Promise<Locator> {
  await page.goto(`${CONTACTS_PATH}?buscar=${encodeURIComponent(search)}`);
  return main(page).getByRole("table").getByRole("link").filter({ hasText: search });
}

/** Clicks and returns the text of the file the browser downloads. */
async function downloadedText(page: Page, trigger: Locator): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger.click()]);
  const file = await download.path();
  return { name: download.suggestedFilename(), text: fs.readFileSync(file, "utf8") };
}

test("[CTO-06][CUM-07] the owner exports all the data of a contact, and the list as CSV", async ({ page }, testInfo) => {
  const ref = uniqueRef(testInfo, "exportar");
  const name = `Exportación ${ref}`;
  await createContactByHand(page, { name, email: `exporta-${ref}@example.com` });

  await test.step("[CTO-06] «Exportar datos» downloads the contact's file", async () => {
    const file = await downloadedText(page, main(page).getByRole("button", { name: "Exportar datos" }));
    expect(file.name).toMatch(/^datos-contacto-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.json$/);
    const data = JSON.parse(file.text) as { contact: { name: string; email: string } };
    expect(data.contact).toMatchObject({ name, email: `exporta-${ref}@example.com` });
  });

  await test.step("[CTO-06] «Exportar» of the list downloads the contacts of the search as CSV", async () => {
    await page.goto(`${CONTACTS_PATH}?buscar=${encodeURIComponent(ref)}`);
    const file = await downloadedText(page, main(page).getByRole("button", { name: "Exportar", exact: true }));
    expect(file.name).toMatch(/^contactos-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = file.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"${name}"`);
  });
});

test("[CTO-07][CUM-07] erasing a contact asks for its name and leaves nothing of it", async ({ page }, testInfo) => {
  const name = `Borrado ${uniqueRef(testInfo, "borrar")}`;
  await createContactByHand(page, { name });
  const card = new URL(page.url()).pathname;

  await main(page).getByRole("button", { name: "Borrar contacto" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: `¿Borrar a «${name}» y todos sus datos?` })).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Borrar contacto" });
  await expect(confirm, "without the name typed, nothing can be erased").toBeDisabled();
  await dialog.getByRole("textbox").fill(name.slice(0, -1));
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill(name);
  await clickAndWaitForPost(page, confirm);

  await expect(page).toHaveURL(/\/contactos$/);
  await expect(await searchContacts(page, name)).toHaveCount(0);
  await page.goto(card);
  await expect(page.getByText("No puedes ver este contacto")).toBeVisible();
});

test("[CTO-04][CTO-05] two contacts of the same person are suggested, picked and merged; their chats end in one", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const ref = uniqueRef(testInfo, "fusionar");
  const first = { name: `Lucía Ferrer ${ref}`, text: uniqueMessage(testInfo, "Hola, soy Lucía") };
  const second = { name: `Lucia Ferrer ${ref}`, text: uniqueMessage(testInfo, "Os escribo desde otro móvil") };
  // The same person writes from two phones to the demo WhatsApp: two contacts, two conversations in one channel.
  await simulateTextMessage(page, { channel: DEMO_WHATSAPP, contactName: first.name, phone: uniquePhone(testInfo, "uno"), text: first.text });
  await simulateTextMessage(page, { channel: DEMO_WHATSAPP, contactName: second.name, phone: uniquePhone(testInfo, "dos"), text: second.text });

  await test.step("[CTO-04] «Posibles duplicados» points them out, but merges nothing on its own", async () => {
    await page.goto(`${CONTACTS_PATH}/duplicados`);
    const pair = main(page).getByRole("listitem").filter({ hasText: first.name }).filter({ hasText: second.name });
    await expect(pair).toHaveCount(1);
    await expect(pair.getByText("Mismo nombre")).toBeVisible();
    await expect(await searchContacts(page, ref)).toHaveCount(2);
  });

  await test.step("[CTO-05] picking both in the list opens the merge", async () => {
    await page.goto(`${CONTACTS_PATH}?buscar=${encodeURIComponent(ref)}`);
    await main(page).getByRole("checkbox", { name: `Seleccionar a ${first.name}` }).check();
    await main(page).getByRole("checkbox", { name: `Seleccionar a ${second.name}` }).check();
    await main(page).getByRole("toolbar", { name: "Acciones con los contactos seleccionados" }).getByRole("button", { name: "Fusionar" }).click();
    await expect(page).toHaveURL(/\/contactos\/fusionar\?uno=.+&otro=.+/);
  });

  await test.step("[CTO-05] the merge shows what moves and, confirmed, leaves one contact with one WhatsApp chat", async () => {
    await main(page).getByRole("radiogroup", { name: "Contacto que se queda" }).getByRole("radio", { name: new RegExp(first.name) }).check();
    await expect(main(page).getByText(/las conversaciones de los dos se unen en una/)).toBeVisible();
    await main(page).getByRole("button", { name: "Fusionar contactos" }).click();
    await clickAndWaitForPost(page, page.getByRole("alertdialog").getByRole("button", { name: "Fusionar contactos" }));
    await expect(page).toHaveURL(CARD_URL);
    await expect(page.getByRole("heading", { level: 1, name: first.name })).toBeVisible();
    const conversations = main(page).locator('a[href^="/bandeja/"]');
    await expect(conversations).toHaveCount(1);
    await conversations.click();
    await expect(page).toHaveURL(CONVERSATION_URL);
    await expect(customerMessage(page, first.text)).toBeVisible();
    await expect(customerMessage(page, second.text)).toBeVisible();
    await expect(await searchContacts(page, ref)).toHaveCount(1);
  });
});

test("[CTO-08][CUM-03] a baja shows on the card and a supervisor lifts it when the customer asks", async ({ page, browser, request, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const name = `Baja ${uniqueRef(testInfo, "baja")}`;
  await simulateTextMessage(page, { channel: DEMO_WHATSAPP, contactName: name, phone: uniquePhone(testInfo), text: "BAJA" });

  const supervisor = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:supervisor`), storageState: authStatePath("supervisor") });
  try {
    const supervisorPage = await supervisor.newPage();
    const notice = supervisorPage.getByRole("alert").filter({ hasText: "Dado de baja" });
    await expect
      .poll(
        async () => {
          await triggerTick(request, baseURL ?? "");
          const links = await searchContacts(supervisorPage, name);
          if ((await links.count()) === 1) await links.click();
          // The card loads after the click (a navigation inside the app is not waited for): look once it is there.
          return notice.waitFor({ state: "visible", timeout: 10_000 }).then(
            () => true,
            () => false,
          );
        },
        { message: "the baja of «BAJA» shows on the card", timeout: 60_000 },
      )
      .toBe(true);

    await notice.getByRole("button", { name: "Levantar baja" }).click();
    const dialog = supervisorPage.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /Cómo lo ha pedido/ }).fill("Lo ha pedido por teléfono");
    await clickAndWaitForPost(supervisorPage, dialog.getByRole("button", { name: "Levantar baja" }));
    await expect(notice).toHaveCount(0);
    await expect(main(supervisorPage).getByText(/^Alta( ·|$)/)).toBeVisible();
  } finally {
    await supervisor.close();
  }
});

test("[PER-01][SEG-04] Supervisor merges but neither exports nor erases; Agente and Solo lectura do none of it", async ({ page, browser }, testInfo) => {
  const name = `Permisos ${uniqueRef(testInfo, "permisos")}`;
  await createContactByHand(page, { name });
  const card = new URL(page.url()).pathname;

  for (const role of ["supervisor", "agent", "viewer"] as const) {
    const context = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:${role}`), storageState: authStatePath(role) });
    try {
      const other = await context.newPage();
      await test.step(`[PER-01] ${role}`, async () => {
        await other.goto(CONTACTS_PATH);
        await expect(main(other).getByRole("button", { name: "Exportar", exact: true })).toHaveCount(0);
        if (role === "supervisor") {
          await expect(main(other).getByRole("link", { name: "Posibles duplicados" })).toBeVisible();
          await other.goto(card);
          await expect(other.getByRole("heading", { level: 1, name })).toBeVisible();
          await expect(main(other).getByRole("button", { name: "Exportar datos" })).toHaveCount(0);
          await expect(main(other).getByRole("button", { name: "Borrar contacto" })).toHaveCount(0);
        } else {
          await expect(main(other).getByRole("link", { name: "Posibles duplicados" })).toHaveCount(0);
          await expect(main(other).getByRole("checkbox")).toHaveCount(0);
          await expectRefused(other, `${CONTACTS_PATH}/duplicados`);
          await expectRefused(other, `${CONTACTS_PATH}/fusionar`);
        }
      });
    } finally {
      await context.close();
    }
  }
});
