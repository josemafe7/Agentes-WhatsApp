// What a person does on screen, in one place: sign in, sign out, read the menu and the «no permission» state.
// Locators follow the accessible names of the screens (docs/pantallas.md, DESIGN.md).
import { expect, type Locator, type Page } from "@playwright/test";
import type { TestUser } from "./users";

export const INVALID_CREDENTIALS = "Email o contraseña incorrectos";
export const NO_PERMISSION = "No tienes permiso para ver esta sección";
export const DEMO_BANNER = "Modo demo";
export const OPENROUTER_BANNER = "Añade tu clave de OpenRouter";

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The path (without query) the page is on. */
export function currentPath(page: Page): string {
  return new URL(page.url()).pathname;
}

/** Exact path match, ignoring the query: /bandeja matches /bandeja?x=1 but not /bandeja/123. */
export function pathPattern(path: string): RegExp {
  return new RegExp(`^[^?#]*//[^/]+${escapeRegExp(path)}/?(?:[?#].*)?$`);
}

export const TOO_MANY_ATTEMPTS = "Demasiados intentos";

/** Clicks and waits for the POST it sends (a Server Action or an API call) to be answered. */
export async function clickAndWaitForPost(page: Page, target: Locator): Promise<void> {
  await Promise.all([page.waitForResponse((response) => response.request().method() === "POST"), target.click()]);
}

export function loginButton(page: Page): Locator {
  return page.getByRole("button", { name: /^(entrar|iniciar sesión)$/i });
}

export async function fillLoginForm(page: Page, user: TestUser): Promise<void> {
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await clickAndWaitForPost(page, loginButton(page));
}

/** Opens /login and signs in through the form (the next page is left to the caller to check). */
export async function signInThroughForm(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await fillLoginForm(page, user);
}

/** The side menu of the panel (desktop): `<nav aria-label="Menú principal">`. */
export function mainMenu(page: Page): Locator {
  return page.getByRole("navigation", { name: "Menú principal" });
}

/** Signs out from the user menu at the bottom of the side menu (DESIGN.md «Armazón de la app»). */
export async function signOutThroughMenu(page: Page, roleLabel: string): Promise<void> {
  const trigger = page.locator('[data-sidebar="footer"]').getByRole("button").filter({ hasText: roleLabel });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
}

/**
 * The page refused to show its content: «No tienes permiso…» in place, or a redirect to some other page of
 * the panel (never to /login: the person is signed in, only their role is short).
 */
export async function expectRefused(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status() ?? 0, `${path} must not fail with a server error`).toBeLessThan(500);
  await expect
    .poll(
      async () => {
        const landed = currentPath(page);
        if (landed === "/login") return "sent to /login";
        if (landed !== path) return "redirected";
        return (await page.getByText(NO_PERMISSION).isVisible()) ? "no-permission" : "shown";
      },
      { message: `${path} should be refused`, timeout: 10_000 },
    )
    .toMatch(/^(redirected|no-permission)$/);
}
