// The two global notices of the demo: «Modo demo» ([ARR-05]) and, while there is no OpenRouter key,
// «Añade tu clave de OpenRouter» ([ARR-14]), with the way to Ajustes › IA only for who can open it ([PER-04]).
// The demo e2e server runs with DEMO_MODE=true and no key (playwright.config.ts blanks OPENROUTER_API_KEY).
import { authStatePath } from "../support/app";
import { expect, test } from "../support/test";
import { DEMO_BANNER, OPENROUTER_BANNER, pathPattern } from "../support/ui";
import { SECTIONS, SETTINGS_PATHS, type RoleKey } from "../support/users";

const AI_SETTINGS = SETTINGS_PATHS.ia;

test.describe("as the demo owner", () => {
  test.use({ storageState: authStatePath("owner") });

  test("[ARR-05] every screen of the panel shows «Modo demo»", async ({ page }) => {
    const screens = [...Object.values(SECTIONS).map((section) => section.href), SETTINGS_PATHS.usuarios, SETTINGS_PATHS.acerca, "/perfil"];
    for (const path of screens) {
      await page.goto(path);
      await expect(page.getByText(DEMO_BANNER, { exact: true }).first(), `${path} shows the demo notice`).toBeVisible();
    }
  });

  test("[ARR-14] without a key the owner is told to add it and taken to Ajustes › IA", async ({ page }) => {
    await page.goto(SECTIONS.bandeja.href);
    const notice = page
      .locator('[role="note"], [role="alert"], [role="status"]')
      .filter({ hasText: OPENROUTER_BANNER })
      .last();
    await expect(notice).toBeVisible();
    const toSettings = notice.locator(`a[href="${AI_SETTINGS}"]`);
    await expect(toSettings).toBeVisible();
    await toSettings.click();
    await expect(page).toHaveURL(pathPattern(AI_SETTINGS));
  });
});

test("[ARR-05] the login page shows «Modo demo» too (docs/pantallas.md)", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText(DEMO_BANNER, { exact: true }).first()).toBeVisible();
});

const ROLES_WITHOUT_KEYS: readonly RoleKey[] = ["supervisor", "agent", "viewer"];

for (const role of ROLES_WITHOUT_KEYS) {
  test.describe(`as the demo ${role}`, () => {
    test.use({ storageState: authStatePath(role) });

    test(`[ARR-05][ARR-14][PER-04] the ${role} sees both notices but no way into the AI keys`, async ({ page }) => {
      await page.goto(SECTIONS.bandeja.href);
      await expect(page.getByText(DEMO_BANNER, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(OPENROUTER_BANNER)).toBeVisible();
      await expect(page.locator(`a[href="${AI_SETTINGS}"]`)).toHaveCount(0);
    });
  });
}
