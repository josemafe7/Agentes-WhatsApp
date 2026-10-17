// Importar contactos ([CTO-11]–[CTO-13]) as the owner does it: «Descargar plantilla», a file with good, repeated and
// wrong rows, «Revisar archivo» (what would happen, row by row), the confirmation of the permissions it brings,
// «Importar», and the same file again, which creates nothing. Each run uses contacts of its own (unique names, emails
// and phones).
import { authStatePath } from "../support/app";
import { uniqueRef } from "../support/names";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

test("[CTO-11][CTO-12][CTO-13] a file is checked first and imported after: good rows go in with their permissions, repeated and wrong rows are listed, and importing it again creates nothing", async ({ page }, testInfo) => {
  const ref = uniqueRef(testInfo, "importar");
  // Phones of 9 digits of this run: «6» + 8 digits of the reference.
  const digits = String(parseInt(ref, 16) % 100_000_000).padStart(8, "0");
  const phone = `6${digits}`;
  const csv = [
    "Nombre;Teléfono;Email;Etiquetas;Avisos de sus citas;Fecha avisos;Cómo dio avisos",
    `Ana ${ref};${phone};ana-${ref}@ejemplo.com;importada;sí;15/09/2026;en persona`,
    `Ana repetida ${ref};+34 ${phone};;;;;`,
    `Sin datos ${ref};;;;;;`,
  ].join("\n");
  const file = { name: `clientes-${ref}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") };

  await page.goto("/contactos");
  await page.getByRole("main").getByRole("link", { name: "Importar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Importar contactos" })).toBeVisible();
  const main = page.getByRole("main");

  await test.step("[CTO-11] «Descargar plantilla» gives an Excel with the titles the app recognises", async () => {
    const download = page.waitForEvent("download");
    await main.getByRole("button", { name: "Descargar plantilla" }).click();
    expect((await download).suggestedFilename()).toBe("plantilla-contactos.xlsx");
  });

  await test.step("[CTO-11][CTO-12] «Revisar archivo» says what would happen, row by row, and asks to confirm the permissions", async () => {
    await main.getByLabel("Archivo", { exact: true }).setInputFiles(file);
    await expect(main.getByLabel("Prefijo de los teléfonos que no lo llevan")).toHaveValue("+34");
    await main.getByRole("button", { name: "Revisar archivo" }).click();
    await expect(main.getByText("1 contacto entrará, 1 se salta porque ya existe y 1 tiene errores.", { exact: false })).toBeVisible();
    await expect(main.getByRole("listitem").filter({ hasText: "No tiene teléfono ni email" })).toContainText("Fila 4");
    await expect(main.getByRole("listitem").filter({ hasText: `Ana repetida ${ref}` })).toContainText("la fila 2 del archivo");
    await expect(main.getByRole("button", { name: "Importar 1 contacto" })).toBeDisabled();
    await main.getByLabel("Confirmo que estos clientes dieron de verdad los permisos que marca el archivo").check();
  });

  await test.step("[CTO-11][CTO-13] «Importar» brings the contact with its permission, and says what it did", async () => {
    await main.getByRole("button", { name: "Importar 1 contacto" }).click();
    await expect(main.getByRole("heading", { name: "Importación terminada" })).toBeVisible();
    await expect(main.getByText("1 contacto importado", { exact: false })).toBeVisible();
    await page.goto(`/contactos?buscar=${encodeURIComponent(`Ana ${ref}`)}`);
    // The card, by its exact name: the chip of the search («Ana …») is a link too, the one that removes it.
    await page.getByRole("main").getByRole("link", { name: `Ana ${ref}`, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Ana ${ref}` })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Avisos de sus citas");
    await expect(page.getByRole("main")).toContainText("En persona");
  });

  await test.step("[CTO-12] the same file again creates nothing: its row matches the contact it created", async () => {
    await page.goto("/contactos/importar");
    await page.getByRole("main").getByLabel("Archivo", { exact: true }).setInputFiles(file);
    await page.getByRole("main").getByRole("button", { name: "Revisar archivo" }).click();
    await expect(page.getByRole("main").getByText("0 contactos entrarán, 2 se saltan porque ya existen", { exact: false })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "Importar 0 contactos" })).toBeDisabled();
  });
});
