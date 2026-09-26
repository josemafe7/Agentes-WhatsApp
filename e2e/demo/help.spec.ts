// Acerca de ([AJU-14]) and Ayuda ([AJU-17]): the app version, and the guides of docs/ inside the app for every role.
import fs from "node:fs";
import path from "node:path";
import { authStatePath } from "../support/app";
import { expect, test } from "../support/test";
import { pathPattern } from "../support/ui";
import { DEMO_USERS } from "../support/users";

const DEPLOYMENT_GUIDE = "Publicar la app en Vercel";
const { version } = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8")) as { version: string };

test.describe("as the demo viewer, the most limited role in Ajustes", () => {
  test.use({ storageState: authStatePath("viewer") });

  test("[AJU-14][AJU-17] Acerca de shows the app version and leads to the guides of Ayuda", async ({ page }) => {
    await page.goto("/ajustes/acerca");
    await expect(page.getByRole("heading", { name: "Acerca de", level: 1 })).toBeVisible();
    await expect(page.getByText(version, { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Abrir la Ayuda" }).click();
    await expect(page).toHaveURL(pathPattern("/ayuda"));
    await expect(page.getByRole("heading", { name: "Ayuda", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: new RegExp(DEPLOYMENT_GUIDE) }).click();
    await expect(page).toHaveURL(pathPattern("/ayuda/despliegue"));
    await expect(page.getByRole("heading", { name: DEPLOYMENT_GUIDE, level: 1 })).toBeVisible();

    // The index of the guide opens each section in place.
    const index = page.getByRole("navigation", { name: "En esta guía" });
    await index.getByRole("link", { name: "6. El cron cada minuto" }).click();
    await expect(page).toHaveURL(/\/ayuda\/despliegue#6-el-cron-cada-minuto$/);
    await expect(page.getByRole("heading", { name: "6. El cron cada minuto", level: 2 })).toBeInViewport();
  });

  test("[AJU-17] a guide that does not exist is «not found»", async ({ page }) => {
    await page.goto("/ayuda/no-existe");
    await expect(page.getByText("Esta página no existe")).toBeVisible();
  });
});

test.describe("as the demo agent", () => {
  test.use({ storageState: authStatePath("agent") });

  test("[AJU-17] Ayuda is in the user menu", async ({ page }) => {
    await page.goto("/bandeja");
    await page.locator('[data-sidebar="footer"]').getByRole("button").filter({ hasText: DEMO_USERS.agent.roleLabel }).click();
    await page.getByRole("menuitem", { name: "Ayuda" }).click();
    await expect(page).toHaveURL(pathPattern("/ayuda"));
    await expect(page.getByRole("link", { name: new RegExp(DEPLOYMENT_GUIDE) })).toBeVisible();
  });
});

test("[AJU-17] Ayuda needs a session", async ({ page }) => {
  await page.goto("/ayuda/despliegue");
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/ayuda/despliegue");
});
