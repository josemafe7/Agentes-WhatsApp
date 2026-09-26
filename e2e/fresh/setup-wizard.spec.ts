// Setup wizard on an empty installation (the «fresh» server: data/e2e-fresh.db with migrations only, no demo,
// DEMO_MODE=false), as after `pnpm db:fresh` ([ARR-17], [ASI-01]–[ASI-11]).
// One test on purpose: the installation can be set up only once, so the steps share that single history.
import type { Page } from "@playwright/test";
import { newPersonContext } from "../support/app";
import { TEST_SECRETS } from "../support/env";
import { clientIpFor, expect, test } from "../support/test";
import {
  clickAndWaitForPost,
  currentPath,
  DEMO_BANNER,
  fillLoginForm,
  INVALID_CREDENTIALS,
  OPENROUTER_BANNER,
  pathPattern,
  signInThroughForm,
} from "../support/ui";
import testKeys from "../mocks/test-keys.json";

const OWNER_STEP_TITLE = "Crea tu cuenta de propietario";
const HOURS_STEP_TITLE = "Horario, festivos y zona horaria";

type Person = { name: string; email: string; password: string };

/** Step 1. The compiled app runs in production mode, so it also asks for the installation code (SETUP_TOKEN). */
async function fillOwnerStep(page: Page, person: Person, setupToken = TEST_SECRETS.SETUP_TOKEN): Promise<void> {
  await page.getByLabel("Tu nombre", { exact: true }).fill(person.name);
  await page.getByLabel("Email", { exact: true }).fill(person.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(person.password);
  await page.getByLabel("Código de instalación", { exact: true }).fill(setupToken);
  await clickAndWaitForPost(page, page.getByRole("button", { name: "Crear cuenta y continuar" }));
}

function stepUrl(step: number): RegExp {
  return new RegExp(`/setup\\?paso=${step}$`);
}

test("[ARR-17][ASI-01][ASI-02][ASI-03][ASI-05][ASI-06][ASI-07][ASI-10][ASI-11] the first owner sets up an empty installation", async ({ page, browser, mock }, testInfo) => {
  // Seven steps and a second browser: more than the default time.
  test.setTimeout(180_000);
  const owner: Person = { name: "Olga Propietaria", email: "olga@e2e.test", password: "e2e-clave-olga-1" };
  const rival: Person = { name: "Rita Rival", email: "rita@e2e.test", password: "e2e-clave-rita-1" };
  const rivalContext = await newPersonContext(browser, testInfo, { clientIp: clientIpFor(`${testInfo.testId}:rival`) });
  const rivalPage = await rivalContext.newPage();

  await test.step("[ASI-01] an empty installation leads every page to the wizard", async () => {
    for (const path of ["/", "/bandeja"]) {
      await page.goto(path);
      await expect(page, `${path} → /setup`).toHaveURL(/\/setup(\?|$)/);
    }
    await expect(page.getByRole("heading", { name: OWNER_STEP_TITLE })).toBeVisible();
  });

  await test.step("[ASI-02] a published installation asks for the installation code: without it nobody becomes the owner", async () => {
    await fillOwnerStep(page, owner, "codigo-adivinado");
    await expect(page.getByText(/código de instalación no es correcto/i)).toBeVisible();
    expect(currentPath(page)).toBe("/setup");
    await expect(page.getByRole("heading", { name: OWNER_STEP_TITLE })).toBeVisible();
  });

  await test.step("[ASI-02] two people on the first step at once: only the first one becomes the owner", async () => {
    await rivalPage.goto("/setup");
    await expect(rivalPage.getByRole("heading", { name: OWNER_STEP_TITLE })).toBeVisible();

    await fillOwnerStep(page, owner);
    await expect(page).toHaveURL(stepUrl(2));

    await fillOwnerStep(rivalPage, rival);
    await expect(rivalPage.getByText(/ya tiene propietario/i)).toBeVisible();
    expect(currentPath(rivalPage)).toBe("/setup");
    // The second account was never created.
    await signInThroughForm(rivalPage, rival);
    await expect(rivalPage.getByText(INVALID_CREDENTIALS)).toBeVisible();
  });

  await test.step("[ASI-03][ASI-05] business name and sector; a health sector warns about health data", async () => {
    await page.getByLabel("Nombre del negocio", { exact: true }).fill("Clínica Sonrisa");
    const sector = page.getByRole("radio", { name: /^Clínica dental/ });
    await sector.click();
    await expect(sector).toBeChecked();
    await expect(page.getByText(/datos de salud/i).first()).toBeVisible();
    await clickAndWaitForPost(page, page.getByRole("button", { name: "Continuar" }));
    await expect(page).toHaveURL(stepUrl(3));
  });

  await test.step("[ASI-11] coming back to the wizard resumes at the first pending step", async () => {
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: HOURS_STEP_TITLE })).toBeVisible();
  });

  await test.step("[ASI-11] signing in again as the owner goes back to the first pending step", async () => {
    // The owner leaves (the session is gone) and comes back later through the sign-in page.
    await page.context().clearCookies();
    await page.goto("/login");
    await fillLoginForm(page, owner);
    await expect(page).toHaveURL(/\/setup(\?|$)/);
    await expect(page.getByRole("heading", { name: HOURS_STEP_TITLE })).toBeVisible();
  });

  await test.step("[ASI-06] weekly hours, with Europe/Madrid as the default time zone", async () => {
    await expect(page.getByRole("combobox", { name: "Zona horaria" })).toContainText("Europe/Madrid");
    await clickAndWaitForPost(page, page.getByRole("button", { name: "Continuar" }));
    await expect(page).toHaveURL(stepUrl(4));
  });

  await test.step("[ASI-07] «Probar clave» asks OpenRouter (simulated) and the step can be left for later", async () => {
    const keyField = page.getByLabel("Clave de OpenRouter", { exact: true });
    const testButton = page.getByRole("button", { name: "Probar clave" });

    await keyField.fill(testKeys.openrouter.invalid);
    await clickAndWaitForPost(page, testButton);
    await expect(page.getByText(/no es válida o ha caducado/i)).toBeVisible();

    await keyField.fill(testKeys.openrouter.valid);
    await clickAndWaitForPost(page, testButton);
    await expect(page.getByText("Clave válida", { exact: true })).toBeVisible();

    // Both checks reached the simulator, never the real OpenRouter.
    const calls = await mock.requests({ service: "openrouter", method: "GET", path: "/api/v1/key" });
    const keysSent = calls.map((call) => call.headers.authorization);
    expect(keysSent).toContain(`Bearer ${testKeys.openrouter.invalid}`);
    expect(keysSent).toContain(`Bearer ${testKeys.openrouter.valid}`);

    // «Hacerlo más tarde» does not keep the key typed in the field.
    await clickAndWaitForPost(page, page.getByRole("button", { name: "Hacerlo más tarde" }));
    await expect(page).toHaveURL(stepUrl(5));
  });

  await test.step("steps still to come (first agent, web chat) can be passed", async () => {
    await clickAndWaitForPost(page, page.getByRole("button", { name: "Continuar" }));
    await expect(page).toHaveURL(stepUrl(6));
    await clickAndWaitForPost(page, page.getByRole("button", { name: "Continuar" }));
    await expect(page).toHaveURL(stepUrl(7));
  });

  await test.step("[ASI-10] step 7 names the channels still to come and never links to a page that does not exist", async () => {
    await expect(page.getByText("Próximamente", { exact: true })).toHaveCount(2);
    const hrefs = await page.locator("main a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    for (const href of hrefs.filter((value) => value.startsWith("/"))) {
      const response = await page.request.get(href);
      expect(response.status(), `${href} exists`).toBeLessThan(400);
    }
  });

  await test.step("[ASI-10] finishing opens the inbox of a real (non-demo) installation without AI", async () => {
    await clickAndWaitForPost(page, page.getByRole("button", { name: "Ir a la bandeja" }));
    await expect(page).toHaveURL(pathPattern("/bandeja"));
    await expect(page.getByText(OPENROUTER_BANNER)).toBeVisible();
    await expect(page.getByText(DEMO_BANNER, { exact: true })).toHaveCount(0);
  });

  await test.step("[ASI-01][ASI-02] once finished, the wizard cannot be opened again", async () => {
    await page.goto("/setup");
    await expect(page).toHaveURL(pathPattern("/bandeja"));

    await rivalPage.goto("/setup");
    await expect(rivalPage).not.toHaveURL(/\/setup(\?|$)/);
    await expect(rivalPage.getByRole("heading", { name: OWNER_STEP_TITLE })).toHaveCount(0);
  });

  await rivalContext.close();
});
