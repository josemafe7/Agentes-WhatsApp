// The installable app ([PWA-01]): manifest, service worker and icons without a session, and in Mi cuenta how to
// install it (iPhone: add to the home screen; Chromium: «Instalar la app»). docs/notificaciones-push.md «Pruebas».
import { devices, type Page } from "@playwright/test";
import { authStatePath } from "../support/app";
import { expect, test } from "../support/test";

/** The demo business (seed/businesses.ts, peluquería). */
const DEMO_BUSINESS = { name: "Peluquería Aurora", color: "#b4235a" } as const;
const PUSH_SECTION = "Avisos push en tus dispositivos";

type ManifestIcon = { src: string; sizes: string; type: string; purpose: string };

function pushSection(page: Page) {
  return page.getByRole("region", { name: PUSH_SECTION });
}

test("[PWA-01] the manifest, the service worker and the icons are served without a session", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const response = await anonymous.get("/manifest.webmanifest", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = (await response.json()) as Record<string, unknown> & { icons: ManifestIcon[] };
    expect(manifest).toMatchObject({
      name: DEMO_BUSINESS.name,
      start_url: "/bandeja",
      display: "standalone",
      lang: "es",
      theme_color: DEMO_BUSINESS.color,
    });
    expect(manifest.icons.map((icon) => [icon.sizes, icon.purpose])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]);
    for (const icon of manifest.icons) {
      const image = await anonymous.get(icon.src, { maxRedirects: 0 });
      expect(image.status(), `${icon.src} is served`).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/png");
    }

    const worker = await anonymous.get("/sw.js", { maxRedirects: 0 });
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toContain("javascript");
    expect(await worker.text()).toContain("showNotification");
  } finally {
    await anonymous.dispose();
  }
});

test("[PWA-01] every page links the manifest, the sign-in page too", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
});

test.describe("in Mi cuenta", () => {
  test.use({ storageState: authStatePath("agent") });

  test("[PWA-01] where the browser offers to install the app, «Instalar la app» opens its prompt", async ({ page }) => {
    await page.goto("/perfil");
    const section = pushSection(page);
    await expect(section.getByText(/instalarla como una app desde el menú del navegador/)).toBeVisible();

    // Chromium fires beforeinstallprompt only when it decides the app can be installed: the test fires it itself.
    await page.evaluate(() => {
      const offer = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(offer, {
        prompt: async () => {
          document.documentElement.dataset.installPrompted = "true";
        },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(offer);
    });
    await section.getByRole("button", { name: "Instalar la app" }).click();
    await expect(section.getByText(/^App instalada\./)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-install-prompted", "true");
  });

  test("[PWA-01][PWA-03] on an iPhone, push is explained as «add it to the home screen» instead of the push button", async ({ browser, clientIp }, testInfo) => {
    const iPhone = devices["iPhone 15"];
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      locale: "es-ES",
      timezoneId: "Europe/Madrid",
      userAgent: iPhone.userAgent,
      viewport: iPhone.viewport,
      deviceScaleFactor: iPhone.deviceScaleFactor,
      isMobile: iPhone.isMobile,
      hasTouch: iPhone.hasTouch,
      extraHTTPHeaders: { "x-forwarded-for": clientIp },
      storageState: authStatePath("agent"),
    });
    try {
      const page = await context.newPage();
      await page.goto("/perfil");
      const section = pushSection(page);
      await expect(section.getByText("Elige «Añadir a pantalla de inicio»", { exact: false })).toBeVisible();
      await expect(section.getByText("Necesitas iOS o iPadOS 16.4 o posterior.")).toBeVisible();
      await expect(section.getByRole("button", { name: "Activar avisos en este dispositivo" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
