// Invitations ([USU-05]–[USU-09]): the administrator invites, the email (saved in data/outbox because the
// demo has no SMTP) carries a one-time link, and the invited person joins with the invited role.
import type { Page } from "@playwright/test";
import { authStatePath, newPersonContext } from "../support/app";
import { RUN_ID } from "../support/env";
import { findEmail, linkIn, waitForEmail } from "../support/outbox";
import { clientIpFor, expect, test } from "../support/test";
import { clickAndWaitForPost, currentPath, fillLoginForm, mainMenu, pathPattern } from "../support/ui";
import { DEMO_USERS, SETTINGS_PATHS } from "../support/users";

const INVITED_ROLE_LABEL = "Supervisor";

async function openInviteDialog(page: Page) {
  await page.goto(SETTINGS_PATHS.usuarios);
  await page.getByRole("button", { name: "Invitar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("as the demo administrator", () => {
  test.use({ storageState: authStatePath("admin") });

  test("[USU-05][USU-07][USU-08] an invited person joins with the invited role through the emailed link", async ({ page, browser, baseURL }, testInfo) => {
    const appUrl = baseURL ?? "";
    const invitee = {
      name: "Inés Invitada",
      email: `invitada-${RUN_ID}-${testInfo.retry}@e2e.test`,
      password: "e2e-clave-invitada-1",
    };
    const since = Date.now();

    const dialog = await openInviteDialog(page);
    await dialog.getByLabel("Email", { exact: true }).fill(invitee.email);
    await dialog.getByRole("combobox", { name: "Rol" }).click();
    await page.getByRole("option", { name: INVITED_ROLE_LABEL, exact: true }).click();
    await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Enviar invitación" }));
    await expect(dialog.getByText("Invitación creada")).toBeVisible();

    const email = await waitForEmail({ to: invitee.email, since });
    const link = linkIn(email, appUrl, "/invitacion/");

    // The invited person, on their own device and without a session.
    const inviteeContext = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:invitee`) });
    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto(link);
    await expect(inviteePage.getByText(INVITED_ROLE_LABEL).first()).toBeVisible();
    await inviteePage.getByLabel("Tu nombre", { exact: true }).fill(invitee.name);
    const passwordFields = inviteePage.locator('input[type="password"]');
    for (let index = 0; index < (await passwordFields.count()); index += 1) {
      await passwordFields.nth(index).fill(invitee.password);
    }
    await clickAndWaitForPost(inviteePage, inviteePage.getByRole("button", { name: "Crear mi cuenta" }));

    // Straight into the panel, or through the login with the new password.
    await expect(inviteePage).toHaveURL(/\/(bandeja|login)(\?|$)/);
    if (currentPath(inviteePage) === "/login") await fillLoginForm(inviteePage, invitee);
    await expect(inviteePage).toHaveURL(pathPattern("/bandeja"));
    await expect(inviteePage.locator('[data-sidebar="footer"]')).toContainText(INVITED_ROLE_LABEL);
    const menu = mainMenu(inviteePage);
    await expect(menu.getByRole("link", { name: "Informes", exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Canales", exact: true })).toHaveCount(0);
    await inviteeContext.close();

    // [USU-08] The link worked once: opened again, it says so and offers no form.
    const laterContext = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:later`) });
    const laterPage = await laterContext.newPage();
    await laterPage.goto(link);
    await expect(laterPage.getByText(/ya no es válid/i).first()).toBeVisible();
    await expect(laterPage.locator('input[type="password"]')).toHaveCount(0);
    await laterContext.close();
  });

  test("[USU-09] an email that already has an account cannot be invited", async ({ page }) => {
    const since = Date.now();
    const dialog = await openInviteDialog(page);
    await dialog.getByLabel("Email", { exact: true }).fill(DEMO_USERS.supervisor.email);
    await clickAndWaitForPost(page, dialog.getByRole("button", { name: "Enviar invitación" }));
    await expect(dialog.getByRole("button", { name: "Enviar invitación" })).toBeVisible();
    await expect(dialog.getByText("Invitación creada")).toHaveCount(0);
    await expect(dialog.getByText(/ya tiene (una )?cuenta/i).first()).toBeVisible();
    // Nothing was sent (invitation emails go out before the action answers).
    expect(findEmail(DEMO_USERS.supervisor.email, since)).toBeNull();
  });
});
