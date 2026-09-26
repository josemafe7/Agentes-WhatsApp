// Signs in once per demo role, through the sign-in form, and saves the session, so tests that are not about
// signing in start already inside the panel (test.use({ storageState: authStatePath(role) })). Tests that end a
// session (sign out, password change) sign in on their own and never reuse these files.
import { authStatePath } from "../support/app";
import { expect, test } from "../support/test";
import { mainMenu, signInThroughForm } from "../support/ui";
import { DEMO_USERS, ROLE_KEYS } from "../support/users";

for (const role of ROLE_KEYS) {
  test(`session for the demo ${role}`, async ({ page }) => {
    await signInThroughForm(page, DEMO_USERS[role]);
    await expect(mainMenu(page), `demo user ${DEMO_USERS[role].email} signs in`).toBeVisible();
    await page.context().storageState({ path: authStatePath(role) });
  });
}
