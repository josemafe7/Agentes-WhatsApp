// The automatic and repeated envíos on screen ([ENV-01], [ENV-15], [ENV-16], [ARR-25], [PER-01]): the demo's automatic
// one after the booking, active; a monthly one created, paused, activated and deleted; who sees what. When they go and
// to whom, with the hour fixed, is proved in Vitest (src/server/campaigns/automatic.test.ts).
import type { Page } from "@playwright/test";
import { authStatePath, newPersonContext } from "../support/app";
import { chooseOption } from "../support/forms";
import { uniqueRef } from "../support/names";
import { clientIpFor, expect, test } from "../support/test";
import { NO_PERMISSION } from "../support/ui";

test.use({ storageState: authStatePath("owner") });

const main = (page: Page) => page.getByRole("main");
const section = (page: Page) => main(page).getByRole("region", { name: "Automáticos y repetidos" });

test("[ENV-01][ENV-15][ARR-25] the demo has an automatic envío after the booking, active, with its next time", async ({ page }) => {
  await page.goto("/envios");
  const rule = section(page).getByRole("listitem").filter({ hasText: "¿Qué tal tu cita?" });
  await expect(rule).toContainText("Activo");
  await expect(rule).toContainText("2 días después de la cita, a las 11:00");
  await expect(rule).toContainText("Próxima vez");
  await rule.getByRole("link", { name: "¿Qué tal tu cita?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "¿Qué tal tu cita?" })).toBeVisible();
  await expect(main(page)).toContainText("Envíos que ha hecho");
});

test("[ENV-16] a monthly one: created for a label, paused, activated again and deleted", async ({ page }, testInfo) => {
  const name = `Bonos ${uniqueRef(testInfo, "mes")}`;
  await page.goto("/envios");
  await section(page).getByRole("link", { name: "Nuevo automático o repetido" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nuevo automático o repetido" })).toBeVisible();

  await test.step("the day of the month, the time, to whom and the message", async () => {
    await main(page).getByLabel("Nombre").fill(name);
    await main(page).getByRole("radio", { name: "Cada mes" }).check();
    await main(page).getByLabel("Día del mes").fill("31");
    await expect(main(page)).toContainText("Si el mes no tiene ese día, sale el último.");
    await main(page).getByLabel("Hora").fill("10:00");
    await main(page).getByRole("checkbox", { name: "WhatsApp" }).check();
    await chooseOption(page, main(page).getByRole("combobox", { name: "Número" }), [/WhatsApp/]);
    await chooseOption(page, main(page).getByRole("combobox", { name: "Plantilla de marketing aprobada" }), [/novedades_y_publicidad/]);
    await main(page).getByRole("button", { name: "Guardar" }).click();
  });

  await test.step("its page says when it goes next", async () => {
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(main(page)).toContainText("Cada mes, el día 31 (o el último, si el mes no lo tiene), a las 10:00 · Todos los contactos");
    await expect(main(page)).toContainText("Próxima vez:");
    await expect(main(page)).toContainText("Activo");
  });

  await test.step("paused, it makes nothing; activated, it goes on", async () => {
    await main(page).getByRole("button", { name: "Pausar" }).click();
    await expect(main(page)).toContainText("En pausa: no hace envíos hasta que lo actives.");
    await main(page).getByRole("button", { name: "Activar" }).click();
    await expect(main(page)).toContainText("Próxima vez:");
  });

  await test.step("deleted, it leaves the list", async () => {
    await main(page).getByRole("button", { name: "Borrar" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Envíos" })).toBeVisible();
    await expect(section(page)).not.toContainText(name);
  });
});

test("[ENV-15][PER-01] Supervisor sees them without creating them; an Agente cannot open them", async ({ browser }, testInfo) => {
  for (const role of ["supervisor", "agent"] as const) {
    const context = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:${role}`), storageState: authStatePath(role) });
    try {
      const page = await context.newPage();
      if (role === "agent") {
        await page.goto("/envios/automaticos/nuevo");
        await expect(page.getByText(NO_PERMISSION)).toBeVisible();
      } else {
        await page.goto("/envios");
        await expect(section(page)).toContainText("¿Qué tal tu cita?");
        await expect(section(page).getByRole("link", { name: "Nuevo automático o repetido" })).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
});
