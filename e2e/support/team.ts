// Ajustes › Usuarios: which channels a person with the Agente role attends ([USU-17], [PER-02]), as the owner sets
// it (src/app/(app)/ajustes/usuarios): «Acciones de {nombre}» → «Elegir canales» → dialog «Canales de {nombre}» with one
// checkbox per channel (none ticked = every channel) → «Guardar canales».
import { expect, type Locator, type Page } from "@playwright/test";
import { clickAndWaitForPost } from "./ui";
import { SETTINGS_PATHS } from "./users";

async function openChannelsDialog(page: Page, userName: string): Promise<Locator> {
  await page.goto(SETTINGS_PATHS.usuarios);
  await page.getByRole("button", { name: `Acciones de ${userName}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Elegir canales" }).click();
  const dialog = page.getByRole("dialog", { name: `Canales de ${userName}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Name and state of every channel checkbox of the dialog (each is labelled by its channel's name). */
async function channelBoxes(dialog: Locator): Promise<{ name: string; checked: boolean }[]> {
  return dialog.getByRole("checkbox").evaluateAll((boxes) =>
    boxes.map((box) => ({
      name: (box.id ? (box.ownerDocument.querySelector(`label[for="${CSS.escape(box.id)}"]`)?.textContent ?? "") : "").trim(),
      checked: box.getAttribute("aria-checked") === "true" || (box instanceof HTMLInputElement && box.checked),
    })),
  );
}

/**
 * Leaves the Agent `userName` attending exactly `channelNames` (empty = every channel) and returns the channels they
 * had, so the test can put them back.
 */
export async function setAgentUserChannels(page: Page, userName: string, channelNames: readonly string[]): Promise<string[]> {
  const dialog = await openChannelsDialog(page, userName);
  const boxes = await channelBoxes(dialog);
  const previous = boxes.filter((box) => box.checked).map((box) => box.name);
  const wanted = new Set(channelNames);
  for (const name of wanted) {
    if (!boxes.some((box) => box.name === name)) throw new Error(`No channel «${name}» in «Canales de ${userName}»`);
  }
  for (const box of boxes) {
    const checkbox = dialog.getByRole("checkbox", { name: box.name, exact: true });
    if (wanted.has(box.name)) await checkbox.check();
    else await checkbox.uncheck();
  }
  await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Guardar canales" }));
  await expect(dialog).toHaveCount(0);
  return previous;
}
