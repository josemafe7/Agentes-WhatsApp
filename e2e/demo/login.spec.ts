// Inicio de sesión ([USU-01]–[USU-03], [USU-13]) and the protections around it ([SEG-06], [SEG-07]).
import { expect, test } from "../support/test";
import {
  clickAndWaitForPost,
  fillLoginForm,
  INVALID_CREDENTIALS,
  loginButton,
  mainMenu,
  pathPattern,
  signInThroughForm,
  signOutThroughMenu,
  TOO_MANY_ATTEMPTS,
} from "../support/ui";
import { DEMO_USERS, E2E_USERS, ROLE_KEYS } from "../support/users";

const MAX_ATTEMPTS_BEFORE_LIMIT = 10;
/** The sign-in form allows 30 attempts per IP in 15 minutes (src/app/(auth)/_lib/throttle.ts); a few more at most. */
const MAX_ATTEMPTS_PER_IP = 35;

for (const role of ROLE_KEYS) {
  const user = DEMO_USERS[role];

  test(`[USU-01][ARR-09] the demo ${role} (${user.email}) signs in, lands in the inbox and signs out`, async ({ page }) => {
    await signInThroughForm(page, user);
    await expect(page).toHaveURL(pathPattern("/bandeja"));
    await expect(mainMenu(page)).toBeVisible();
    await expect(page.locator('[data-sidebar="footer"]')).toContainText(user.roleLabel);

    await signOutThroughMenu(page, user.roleLabel);
    await expect(page).toHaveURL(pathPattern("/login"));

    // The session is really over: a private page sends to the login again ([USU-02]).
    await page.goto("/bandeja");
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });
}

test("[USU-01] a wrong password and an unknown email get the same generic message", async ({ page }) => {
  await signInThroughForm(page, { email: DEMO_USERS.viewer.email, password: "no-es-la-clave" });
  await expect(page.getByText(INVALID_CREDENTIALS)).toBeVisible();
  await expect(page).toHaveURL(pathPattern("/login"));

  await fillLoginForm(page, { email: "nadie-registrado@e2e.test", password: "no-es-la-clave" });
  await expect(page.getByText(INVALID_CREDENTIALS)).toBeVisible();
  await expect(page).toHaveURL(pathPattern("/login"));
  await expect(page.getByText(/no existe|no está registrad|contraseña incorrecta\b/i)).toHaveCount(0);
});

test("[USU-02] a private page sends to the login and, after signing in, back to it", async ({ page }) => {
  await page.goto("/agenda");
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/agenda");

  await fillLoginForm(page, DEMO_USERS.owner);
  await expect(page).toHaveURL(pathPattern("/agenda"));
});

test("[USU-02] after signing in, the return address can only be a page of the app", async ({ page, baseURL }) => {
  await page.goto(`/login?next=${encodeURIComponent("//evil.invalid/robar")}`);
  await fillLoginForm(page, DEMO_USERS.owner);
  await expect(page).toHaveURL(pathPattern("/bandeja"));
  expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? "").origin);
});

test("[USU-13] after several wrong passwords for one email, even the right one is refused for a while", async ({ page }) => {
  const user = E2E_USERS.rateLimited;
  await page.goto("/login");
  const tooMany = page.getByText(TOO_MANY_ATTEMPTS);
  let attempts = 0;
  while (attempts < MAX_ATTEMPTS_BEFORE_LIMIT && !(await tooMany.isVisible())) {
    attempts += 1;
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(`equivocada-${attempts}`);
    await clickAndWaitForPost(page, loginButton(page));
  }
  await expect(tooMany, `the limit shows up within ${MAX_ATTEMPTS_BEFORE_LIMIT} wrong attempts`).toBeVisible();

  await fillLoginForm(page, user);
  await expect(page).toHaveURL(pathPattern("/login"));
  await expect(page.getByText(new RegExp(`${TOO_MANY_ATTEMPTS}|${INVALID_CREDENTIALS}`))).toBeVisible();
});

test("[USU-13][SEG-07] a burst of sign-in attempts from one IP is stopped, and there is no way around the form", async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  // Better Auth's own sign-in endpoint does not answer over HTTP: the form, with its limits, is the only way in.
  const direct = await request.post(`${baseURL ?? ""}/api/auth/sign-in/email`, {
    data: { email: DEMO_USERS.viewer.email, password: DEMO_USERS.viewer.password },
    headers: { origin: baseURL ?? "" },
    failOnStatusCode: false,
  });
  expect(direct.status()).toBe(404);

  // Every attempt with another email, all from this test's IP.
  await page.goto("/login");
  const tooMany = page.getByText(TOO_MANY_ATTEMPTS);
  let attempts = 0;
  while (attempts < MAX_ATTEMPTS_PER_IP && !(await tooMany.isVisible())) {
    attempts += 1;
    await page.getByLabel("Email", { exact: true }).fill(`rafaga-${attempts}@e2e.test`);
    await page.getByLabel("Contraseña", { exact: true }).fill("no-es-la-clave");
    await clickAndWaitForPost(page, loginButton(page));
  }
  await expect(tooMany, `the limit shows up within ${MAX_ATTEMPTS_PER_IP} attempts`).toBeVisible();

  // While limited, not even the right password gets in from that IP.
  await fillLoginForm(page, DEMO_USERS.viewer);
  await expect(page).toHaveURL(pathPattern("/login"));
  await expect(tooMany).toBeVisible();
});

test("[USU-03] there is no public sign-up", async ({ page, request, baseURL }) => {
  const url = baseURL ?? "";
  const candidate = { name: "Intrusa", email: "registro-directo@e2e.test", password: "una-clave-larga-1" };
  const signUp = await request.post(`${url}/api/auth/sign-up/email`, {
    data: candidate,
    headers: { origin: url },
    failOnStatusCode: false,
  });
  expect(signUp.status()).toBeGreaterThanOrEqual(400);

  await signInThroughForm(page, candidate);
  await expect(page.getByText(INVALID_CREDENTIALS)).toBeVisible();
  await expect(page).toHaveURL(pathPattern("/login"));
});

test("[SEG-06] a request sent from another site cannot end the session", async ({ page, baseURL }) => {
  const url = baseURL ?? "";
  await signInThroughForm(page, DEMO_USERS.viewer);
  await expect(mainMenu(page)).toBeVisible();
  // page.request carries this browser's session cookie.
  const request = page.request;

  // A well-formed JSON request (an empty body without Content-Type is refused earlier, with 415, and would not
  // reach the origin check) sent from another site: Better Auth's origin check refuses it.
  const forged = await request.post(`${url}/api/auth/sign-out`, {
    data: {},
    headers: { origin: "https://evil.invalid" },
    failOnStatusCode: false,
  });
  expect(forged.status()).toBe(403);
  // What a page on another site can really send without CORS (a form post) is refused as well.
  const formPost = await request.post(`${url}/api/auth/sign-out`, {
    form: {},
    headers: { origin: "https://evil.invalid" },
    failOnStatusCode: false,
  });
  expect(formPost.status()).toBeGreaterThanOrEqual(400);

  const session = await request.get(`${url}/api/auth/get-session`);
  expect(session.status()).toBe(200);
  const body: unknown = await session.json();
  expect(body).toMatchObject({ user: { email: DEMO_USERS.viewer.email } });
});
