import { expect, test } from "../support/test";
import { mainMenu, signInThroughForm } from "../support/ui";
import { DEMO_USERS } from "../support/users";

test("[SEG-11] every page sends the security headers and hides X-Powered-By", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toBe("camera=(), microphone=(self), geolocation=()");
  expect(headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains; preload");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("[SEG-11] the session cookie cannot be read by page scripts", async ({ page }) => {
  await signInThroughForm(page, DEMO_USERS.viewer);
  await expect(mainMenu(page)).toBeVisible();
  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name.endsWith("session_token"));
  expect(sessionCookie, "Better Auth sets the session cookie").toBeDefined();
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");
});

test("the pages are in Spanish", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page).toHaveTitle(/\S/);
});
