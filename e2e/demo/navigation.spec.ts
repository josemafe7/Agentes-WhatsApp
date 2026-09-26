// What each role sees in the menu and what it can open by typing an address ([PER-02]–[PER-04], [SEG-04]).
// Hiding a link is not the protection: every forbidden page is also opened directly.
import { authStatePath } from "../support/app";
import { expect, test } from "../support/test";
import { currentPath, expectRefused, mainMenu, NO_PERMISSION } from "../support/ui";
import { FORBIDDEN_PAGES, ROLE_KEYS, SECTIONS, SETTINGS_PATHS, VISIBLE_SECTIONS, type SectionKey } from "../support/users";

const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[];
/** Settings pages beyond «Mi cuenta» and «Acerca de»: only owner and administrator ([PER-03], [PER-04]). */
const ADMIN_SETTINGS = [
  SETTINGS_PATHS.negocio,
  SETTINGS_PATHS.usuarios,
  SETTINGS_PATHS.horario,
  SETTINGS_PATHS.ia,
  SETTINGS_PATHS.correo,
  SETTINGS_PATHS.privacidad,
  SETTINGS_PATHS.notificaciones,
  SETTINGS_PATHS.actividad,
  SETTINGS_PATHS.diagnostico,
];

for (const role of ROLE_KEYS) {
  test.describe(`as the demo ${role}`, () => {
    test.use({ storageState: authStatePath(role) });

    test(`[PER-02][PER-03][PER-04] the menu of the ${role} shows only the sections of the role`, async ({ page }) => {
      await page.goto("/bandeja");
      const menu = mainMenu(page);
      await expect(menu).toBeVisible();
      for (const key of SECTION_KEYS) {
        const { label, href } = SECTIONS[key];
        const link = menu.getByRole("link", { name: label, exact: true });
        if (VISIBLE_SECTIONS[role].includes(key)) {
          await expect(link, `${label} is in the menu`).toBeVisible();
          await expect(link).toHaveAttribute("href", href);
        } else {
          await expect(link, `${label} is not in the menu`).toHaveCount(0);
          await expect(page.locator(`a[href="${href}"]`), `no link to ${href} anywhere`).toHaveCount(0);
        }
      }
    });

    test(`[PER-01] the ${role} can open every section of the menu`, async ({ page }) => {
      for (const key of VISIBLE_SECTIONS[role]) {
        const { href } = SECTIONS[key];
        const response = await page.goto(href);
        expect(response?.status() ?? 0, `${href} answers`).toBeLessThan(400);
        expect(currentPath(page), `${href} is not sent to the login`).not.toBe("/login");
        await expect(page.getByText(NO_PERMISSION), `${href} is allowed`).toHaveCount(0);
      }
    });

    test(`[PER-03][PER-04] Ajustes offers the ${role} only the pages of the role`, async ({ page }) => {
      await page.goto(SECTIONS.ajustes.href);
      await expect(page.locator(`a[href="${SETTINGS_PATHS.acerca}"]`).first(), "Acerca de is for everyone").toBeVisible();
      const seesAdminSettings = role === "owner" || role === "admin";
      for (const path of ADMIN_SETTINGS) {
        const link = page.locator(`a[href="${path}"]`);
        if (seesAdminSettings) await expect(link.first(), `${path} is offered`).toBeVisible();
        else await expect(link, `${path} is not offered`).toHaveCount(0);
      }
    });

    if (FORBIDDEN_PAGES[role].length > 0) {
      test(`[SEG-04][PER-03][PER-04] the ${role} cannot open other pages by typing their address`, async ({ page }) => {
        for (const path of FORBIDDEN_PAGES[role]) await expectRefused(page, path);
      });
    }
  });
}
