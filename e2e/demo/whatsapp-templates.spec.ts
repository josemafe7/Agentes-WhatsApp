// «Nueva plantilla» in the panel of a WhatsApp number ([WA-57], [WA-58], [WA-59], [ARR-25]): it starts from the app's
// models, with the booking's data as named variables, the buttons «Confirmo» / «Necesito cambiarla» and a time-to-live.
// On the demo number it is approved at once and nothing reaches Meta; on a number of Meta it goes to Meta's review
// (docs/integracion-whatsapp-plantillas.md §1) and stays «En revisión».
import { authStatePath } from "../support/app";
import { channelCard, CHANNELS_PATH } from "../support/channels";
import { uniqueRef } from "../support/names";
import { expect, test } from "../support/test";
import { clickAndWaitForPost } from "../support/ui";
import { channelPanelPath, connectWhatsAppNumber, disableChannelQuietly } from "../support/whatsapp";
import { graphPath, metaCalls, testNumber } from "../support/whatsapp-meta";
import type { Page } from "@playwright/test";

test.use({ storageState: authStatePath("owner") });

/** «Nueva plantilla» from a model, with a name of its own, sent; the toast says how it went. */
async function createFromModel(page: Page, model: "Recordatorio de cita" | "Novedades y publicidad", name: string, toast: string): Promise<void> {
  await page.getByRole("main").getByRole("button", { name: "Nueva plantilla" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva plantilla" });
  await dialog.getByRole("button", { name: model, exact: true }).click();
  await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill(name);
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Enviar a Meta" }));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(toast)).toBeVisible();
}

function templateRow(page: Page, name: string) {
  return page.getByRole("main").getByRole("listitem").filter({ hasText: name });
}

test("[WA-57][WA-58][ARR-25] on the demo number, the reminder model is approved at once, with its data, buttons and time-to-live, without calling Meta", async ({ page, mock }, testInfo) => {
  const name = `recordatorio_${uniqueRef(testInfo, "plantilla demo")}`;
  const before = (await mock.requests({ service: "meta", method: "POST" })).length;
  await page.goto(CHANNELS_PATH);
  await channelCard(page, "WhatsApp").getByRole("link", { name: "WhatsApp", exact: true }).click();
  await expect(page.getByRole("main").getByRole("button", { name: "Nueva plantilla" })).toBeVisible();

  await createFromModel(page, "Recordatorio de cita", name, "Plantilla creada y aprobada.");
  const row = templateRow(page, name);
  await expect(row).toContainText("Aprobada");
  await expect(row).toContainText("Utilidad");
  await expect(row).toContainText("Creada desde la app");
  await expect(row).toContainText("Caducidad: 1 hora");
  // [WA-62] What each button does comes set: «Confirmo» confirms, «Necesito cambiarla» asks for a change.
  await expect(row.getByText("«Confirmo»")).toBeVisible();
  await expect(row.getByText("«Necesito cambiarla»")).toBeVisible();
  expect(await mock.requests({ service: "meta", method: "POST" })).toHaveLength(before);
});

test("[WA-57][WA-58][WA-59] on a number of Meta it goes to the review with named variables, the two buttons and its time-to-live, and stays «En revisión»", async ({ page, mock }, testInfo) => {
  test.setTimeout(150_000);
  const number = testNumber(testInfo, "WhatsApp plantillas");
  const name = `recordatorio_${uniqueRef(testInfo, "plantilla meta")}`;
  let channelId: string | null = null;
  try {
    channelId = await connectWhatsAppNumber(page, number);
    await page.goto(channelPanelPath(channelId));
    await createFromModel(page, "Recordatorio de cita", name, "Plantilla enviada: queda «En revisión» hasta que Meta responda.");
    await expect(templateRow(page, name)).toContainText("En revisión");

    const [created] = await metaCalls(mock, "POST", graphPath(number.wabaId, "message_templates"));
    expect(created.body).toMatchObject({ name, language: "es_ES", category: "UTILITY", parameter_format: "NAMED", message_send_ttl_seconds: 3_600 });
    const components = (created.body as { components: { type: string; text?: string; buttons?: unknown[] }[] }).components;
    expect(components.find((component) => component.type === "BODY")?.text).toContain("{{nombre}}");
    expect(components.find((component) => component.type === "BUTTONS")?.buttons).toEqual([
      { type: "QUICK_REPLY", text: "Confirmo" },
      { type: "QUICK_REPLY", text: "Necesito cambiarla" },
    ]);
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});
