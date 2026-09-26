// Password recovery ([USU-10]): same answer whether the email exists or not; a one-time link by email (sent by
// the background queue, which the tests run through /api/cron/tick); the new password closes other sessions.
import type { Page } from "@playwright/test";
import { newPersonContext, triggerTick } from "../support/app";
import { findEmail, waitForEmail } from "../support/outbox";
import { clientIpFor, expect, test } from "../support/test";
import { clickAndWaitForPost, fillLoginForm, INVALID_CREDENTIALS, mainMenu, pathPattern, signInThroughForm } from "../support/ui";
import { DEMO_USERS, E2E_USERS } from "../support/users";

const RESET_REQUESTED = "Si el email existe, te hemos enviado un enlace";
const NEW_PASSWORD = "e2e-clave-nueva-2";

async function requestReset(page: Page, email: string): Promise<void> {
  await page.goto("/recuperar");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await clickAndWaitForPost(page, page.getByRole("button", { name: "Enviar enlace" }));
  await expect(page.getByText(RESET_REQUESTED)).toBeVisible();
}

test("[USU-10] asking for a link gives the same answer whether the email exists or not", async ({ page, request, baseURL }) => {
  const appUrl = baseURL ?? "";
  const unknown = "nadie-recupera@e2e.test";
  const known = DEMO_USERS.viewer.email;
  const since = Date.now();

  await requestReset(page, unknown);
  await requestReset(page, known);

  // Once the queue has sent the email of the real account, there is still nothing for the unknown address.
  await waitForEmail({ to: known, since, onPoll: () => triggerTick(request, appUrl) });
  expect(findEmail(unknown, since)).toBeNull();
});

test("[USU-10] a forgotten password is replaced through a one-time emailed link", async ({ page, request, browser, baseURL }, testInfo) => {
  const appUrl = baseURL ?? "";
  const user = E2E_USERS.passwordReset;
  const since = Date.now();

  // Another device where the person is signed in: changing the password must close that session.
  const otherDevice = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:other-device`) });
  const otherPage = await otherDevice.newPage();
  await signInThroughForm(otherPage, user);
  const wrongPassword = otherPage.getByText(INVALID_CREDENTIALS);
  await expect(mainMenu(otherPage).or(wrongPassword)).toBeVisible();
  // A retry runs after the password already changed.
  if (await wrongPassword.isVisible()) await fillLoginForm(otherPage, { email: user.email, password: NEW_PASSWORD });
  await expect(mainMenu(otherPage)).toBeVisible();

  await page.goto("/login");
  await page.getByRole("link", { name: /olvidado tu contraseña/i }).click();
  await expect(page).toHaveURL(pathPattern("/recuperar"));
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await clickAndWaitForPost(page, page.getByRole("button", { name: "Enviar enlace" }));
  await expect(page.getByText(RESET_REQUESTED)).toBeVisible();

  const email = await waitForEmail({ to: user.email, since, onPoll: () => triggerTick(request, appUrl) });
  const link = email.links.find((candidate) => new URL(candidate).origin === new URL(appUrl).origin) ?? "";
  expect(link, `the email «${email.subject}» carries a link to the app`).not.toBe("");

  await page.goto(link);
  await expect(page).toHaveURL(/\/restablecer/);
  const passwordFields = page.locator('input[type="password"]');
  await expect(passwordFields.first()).toBeVisible();
  for (let index = 0; index < (await passwordFields.count()); index += 1) {
    await passwordFields.nth(index).fill(NEW_PASSWORD);
  }
  await clickAndWaitForPost(page, page.getByRole("button", { name: "Guardar contraseña" }));
  await expect(page).not.toHaveURL(/\/restablecer/);

  // The old password stops working; the new one works.
  await signInThroughForm(page, user);
  await expect(page.getByText(INVALID_CREDENTIALS)).toBeVisible();
  await fillLoginForm(page, { email: user.email, password: NEW_PASSWORD });
  await expect(page).toHaveURL(pathPattern("/bandeja"));

  // The other device lost its session.
  const session = await otherDevice.request.get(`${appUrl}/api/auth/get-session`);
  expect(await session.json()).toBeNull();
  await otherDevice.close();

  // The link worked once.
  const laterContext = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:later`) });
  const laterPage = await laterContext.newPage();
  await laterPage.goto(link);
  await expect(laterPage.getByText(/ya no es válido/i).first()).toBeVisible();
  await laterContext.close();
});
