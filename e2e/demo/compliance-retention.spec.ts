// Conservación ([CUM-05], [CUM-06], [AJU-07], [AJU-15]): Ajustes › Privacidad y legal keeps the periods, with a wrong
// one explained next to its field; the daily clean-up runs by itself (its job exists from the moment the server starts)
// and leaves in the activity log how much it deleted or anonymized.
import { authStatePath } from "../support/app";
import { runQueue } from "../support/engine";
import { expect, test } from "../support/test";

test.use({ storageState: authStatePath("owner") });

const PRIVACY_PATH = "/ajustes/privacidad";
const CLEANUP_LOG_PATH = "/ajustes/actividad?accion=retention.cleanup";
const WEBHOOK_DAYS = "Avisos en bruto de los canales";

test("[CUM-05][AJU-07][AJU-15] the periods are kept, and a wrong one is explained next to its field", async ({ page }) => {
  await page.goto(PRIVACY_PATH);
  const main = page.getByRole("main");
  const webhookDays = main.getByLabel(WEBHOOK_DAYS);
  const save = main.getByRole("button", { name: "Guardar cambios" });
  const before = await webhookDays.inputValue();
  try {
    await webhookDays.fill("45");
    await save.click();
    await expect(main.getByText("Entre 7 y 30 días.")).toBeVisible();

    await webhookDays.fill("10");
    await save.click();
    await expect(main.getByText("Cambios guardados.")).toBeVisible();
    await page.reload();
    await expect(main.getByLabel(WEBHOOK_DAYS)).toHaveValue("10");
  } finally {
    await page.goto(PRIVACY_PATH);
    await main.getByLabel(WEBHOOK_DAYS).fill(before || "14");
    await main.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(main.getByText("Cambios guardados.")).toBeVisible();
  }
});

test("[CUM-06][CUM-05] the daily clean-up runs by itself and says in the activity log how much went", async ({ page, request }) => {
  const main = page.getByRole("main");
  const cleanup = main.getByRole("row").filter({ hasText: "Borró datos caducados" });
  await expect
    .poll(
      async () => {
        await runQueue(request);
        await page.goto(CLEANUP_LOG_PATH);
        return cleanup.count();
      },
      { message: "the clean-up of the day is in the activity log", timeout: 30_000, intervals: [1_000, 2_000] },
    )
    .toBeGreaterThan(0);
  const entry = cleanup.first();
  await expect(entry).toContainText("Sistema");
  await expect(entry).toContainText("conversaciones borradas");
  await expect(entry).toContainText("avisos en bruto borrados");
});
