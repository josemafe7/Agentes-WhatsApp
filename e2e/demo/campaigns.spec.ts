// Envíos on screen ([ENV-01]–[ENV-12], [PER-09]): the demo's done envío with its results; an envío to the contacts marked
// in Contactos — who gets it and why not, scheduled, sent by the demo WhatsApp and its results —; the email not offered
// without a public address; who sees what; and the public «Darme de baja» page of an email. The rules behind (pace,
// Meta's limit, pauses, next channel) are proved in Vitest (src/server/campaigns/*.test.ts).
import type { Page } from "@playwright/test";
import { authStatePath, newPersonContext, triggerTick } from "../support/app";
import { UNSUBSCRIBE_FIXTURE } from "../support/campaign-fixtures";
import { chooseOption } from "../support/forms";
import { uniquePhone, uniqueRef } from "../support/names";
import { DEMO_WHATSAPP, simulateTextMessage } from "../support/simulator";
import { clientIpFor, expect, test } from "../support/test";
import { clickAndWaitForPost, mainMenu, NO_PERMISSION } from "../support/ui";

test.use({ storageState: authStatePath("owner") });

const main = (page: Page) => page.getByRole("main");

/** Opens a contact's card from the list. */
async function openCard(page: Page, name: string): Promise<void> {
  await page.goto(`/contactos?buscar=${encodeURIComponent(name)}`);
  await main(page).getByRole("table").getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("[ENV-01][ENV-12][ARR-25] the demo shows an envío done, with its results, and another scheduled", async ({ page }) => {
  await page.goto("/envios");
  await expect(page.getByRole("heading", { level: 1, name: "Envíos" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Guía de envíos" })).toBeVisible();
  const done = main(page).getByRole("row").filter({ hasText: "Novedades de la temporada" });
  await expect(done).toContainText("Terminado");
  await expect(main(page).getByRole("row").filter({ hasText: "Bonos de este mes" })).toContainText("Programado");

  await done.getByRole("link", { name: "Novedades de la temporada" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Novedades de la temporada" })).toBeVisible();
  const results = main(page).getByRole("region", { name: "Resultados" });
  await expect(results.getByText("Leídos")).toBeVisible();
  await expect(main(page).getByRole("table")).toContainText("Sin el permiso «Novedades y publicidad»");
});

test("[ENV-02][ENV-04][ENV-07][ENV-08][ENV-12] an envío to the contacts marked: who gets it and why not, then it goes by the demo WhatsApp and says how it went", async ({ page, request, baseURL }, testInfo) => {
  const ref = uniqueRef(testInfo, "envio");
  const withPermission = `Con permiso ${ref}`;
  const without = `Sin permiso ${ref}`;
  const name = `Envío ${ref}`;

  await test.step("two customers write by WhatsApp; one gives «Novedades y publicidad» at the counter", async () => {
    await simulateTextMessage(page, { channel: DEMO_WHATSAPP, contactName: withPermission, phone: uniquePhone(testInfo, "con"), text: "Hola" });
    await simulateTextMessage(page, { channel: DEMO_WHATSAPP, contactName: without, phone: uniquePhone(testInfo, "sin"), text: "Hola" });
    await openCard(page, withPermission);
    await main(page).getByRole("button", { name: "Marcar el permiso «Novedades y publicidad»" }).click();
    const dialog = page.getByRole("dialog");
    await chooseOption(page, dialog.getByRole("combobox", { name: "Cómo lo dio" }), "En persona");
    await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Marcar permiso" }));
    await expect(dialog).toBeHidden();
  });

  await test.step("[AJU-18] the send hours cover any hour of the run", async () => {
    await page.goto("/ajustes/envios");
    await main(page).getByLabel("Desde").fill("00:00");
    await main(page).getByLabel("Hasta").fill("23:59");
    await main(page).getByRole("button", { name: "Guardar" }).click();
    await expect(main(page).getByText("Ajustes de envíos guardados.")).toBeVisible();
  });

  await test.step("[ENV-02] marked in Contactos, «Programar envío»", async () => {
    await page.goto(`/contactos?buscar=${encodeURIComponent(ref)}`);
    for (const contact of [withPermission, without]) await main(page).getByRole("checkbox", { name: `Seleccionar a ${contact}` }).first().check();
    await main(page).getByRole("toolbar", { name: "Acciones con los contactos seleccionados" }).getByRole("link", { name: "Programar envío" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Programar envío" })).toBeVisible();
    await expect(main(page)).toContainText("2 contactos marcados");
  });

  await test.step("[ENV-04] the demo WhatsApp with its publicidad template; no email without a public address", async () => {
    await main(page).getByLabel("Nombre").fill(name);
    await main(page).getByRole("checkbox", { name: "WhatsApp" }).check();
    await chooseOption(page, main(page).getByRole("combobox", { name: "Número" }), [/WhatsApp/]);
    await chooseOption(page, main(page).getByRole("combobox", { name: "Plantilla de marketing aprobada" }), [/novedades_y_publicidad/]);
    await expect(main(page).getByRole("checkbox", { name: "Correo" })).toBeDisabled();
    await expect(main(page)).toContainText("El correo no se ofrece");
  });

  await test.step("[ENV-07] «Revisar destinatarios»: one gets it, the other has no permission; the cost by WhatsApp", async () => {
    await expect(main(page).getByRole("button", { name: "Programar envío" })).toBeDisabled();
    await main(page).getByRole("button", { name: "Revisar destinatarios" }).click();
    const review = main(page).getByRole("region", { name: /Lo recibirán/ });
    await expect(review.getByRole("heading", { name: "Lo recibirán 1 de 2 contactos" })).toBeVisible();
    await expect(review).toContainText("Por WhatsApp: 1");
    await expect(review).toContainText("Sin el permiso «Novedades y publicidad»: 1");
    await expect(review).toContainText("Coste estimado por WhatsApp");
  });

  await test.step("[ENV-08][ENV-12] scheduled «Ahora», it goes by the demo WhatsApp; the other is «No enviado» with its reason", async () => {
    await main(page).getByRole("button", { name: "Programar envío" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(async () => {
      await triggerTick(request, baseURL ?? "");
      await page.reload();
      await expect(main(page).getByRole("row").filter({ hasText: withPermission })).toContainText(/Enviado|Entregado|Leído/, { timeout: 2_000 });
    }).toPass({ timeout: 45_000 });
    const other = main(page).getByRole("row").filter({ hasText: without });
    await expect(other).toContainText("No enviado");
    await expect(other).toContainText("Sin el permiso «Novedades y publicidad»");
  });

  await test.step("[ENV-12] the conversation says which envío the message is", async () => {
    await openCard(page, withPermission);
    await main(page).getByRole("link", { name: /Ver conversación|Abrir conversación|WhatsApp/ }).first().click();
    await expect(main(page)).toContainText(`Envío «${name}»`);
  });
});

test("[ENV-01][PER-01] Supervisor and Solo lectura see the envíos without programming them; an Agente does not see them", async ({ browser }, testInfo) => {
  for (const role of ["supervisor", "viewer", "agent"] as const) {
    const context = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:${role}`), storageState: authStatePath(role) });
    try {
      const page = await context.newPage();
      await page.goto("/envios");
      if (role === "agent") {
        await expect(page.getByText(NO_PERMISSION)).toBeVisible();
        await expect(mainMenu(page).getByRole("link", { name: "Envíos", exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByRole("heading", { level: 1, name: "Envíos" })).toBeVisible();
        await expect(main(page).getByRole("link", { name: "Programar envío" })).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
});

test("[ENV-11][PER-09] «Darme de baja» works without signing in, only with a link of ours, and the card shows it", async ({ browser, page }, testInfo) => {
  const anonymous = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:anonimo`) });
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto("/baja/no-es-un-enlace-nuestro-12345");
    await expect(visitor.getByText("Este enlace no es válido.", { exact: false })).toBeVisible();
    await visitor.goto(`/baja/${UNSUBSCRIBE_FIXTURE.token}`);
    await expect(visitor.getByText("¿No quieres recibir más novedades ni publicidad", { exact: false })).toBeVisible();
    await visitor.getByRole("button", { name: "Darme de baja" }).click();
    await expect(visitor.getByRole("status")).toContainText("ya no recibirás novedades ni publicidad");
  } finally {
    await anonymous.close();
  }
  await openCard(page, UNSUBSCRIBE_FIXTURE.contactName);
  await expect(main(page)).toContainText("Está dado de baja de novedades y publicidad");
});
