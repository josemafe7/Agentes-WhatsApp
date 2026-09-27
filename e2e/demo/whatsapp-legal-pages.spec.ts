// The three legal pages Meta asks for to publish the app ([CUM-08], [WA-21]): public (no session), with the business's
// name, the date of the text and links between them. Fase 3 serves them with default texts.
import { expect, test } from "../support/test";

const PAGES = [
  { path: "/legal/privacidad", title: "Política de privacidad" },
  { path: "/legal/terminos", title: "Términos del servicio" },
  { path: "/legal/eliminacion-datos", title: "Eliminación de datos" },
] as const;

for (const legal of PAGES) {
  test(`[CUM-08][WA-21] ${legal.path} is public, names the business and links the other two pages`, async ({ page }) => {
    const response = await page.goto(legal.path);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname, "no sign-in in between").toBe(legal.path);
    await expect(page.getByRole("heading", { level: 1, name: legal.title })).toBeVisible();
    await expect(page.getByText(/Última actualización/)).toBeVisible();
    await expect(page.getByText(/Responsable:/)).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Páginas legales" });
    for (const other of PAGES) await expect(nav.getByRole("link", { name: other.title })).toHaveAttribute("href", other.path);
  });
}
