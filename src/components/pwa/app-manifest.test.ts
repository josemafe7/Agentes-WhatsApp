import { describe, expect, it } from "vitest";
import { APP_ICON_ROUTE } from "./app-icon";
import { buildAppManifest, shortAppName } from "./app-manifest";

const business = { name: "Peluquería Aurora", color: "#b4235a", logoFileKey: null };

describe("web app manifest [PWA-01]", () => {
  it("installs with the business name and colour, standalone (needed for push on iPhone), and opens on the inbox", () => {
    expect(buildAppManifest(business)).toMatchObject({
      id: "/",
      name: "Peluquería Aurora",
      short_name: "Peluquería",
      start_url: "/bandeja",
      scope: "/",
      display: "standalone",
      lang: "es",
      theme_color: "#b4235a",
      background_color: "#b4235a",
    });
  });

  it("offers 192 and 512 px PNG icons and a maskable one, all drawn by the app from the business", () => {
    const icons = buildAppManifest(business).icons ?? [];
    expect(icons.map((icon) => [icon.sizes, icon.type, icon.purpose])).toEqual([
      ["192x192", "image/png", "any"],
      ["512x512", "image/png", "any"],
      ["512x512", "image/png", "maskable"],
    ]);
    for (const icon of icons) expect(icon.src.startsWith(`${APP_ICON_ROUTE}?`)).toBe(true);
  });

  it("a new logo, name or colour changes the icon addresses, so an installed app picks up the new icon", () => {
    const before = buildAppManifest(business).icons?.[0]?.src;
    expect(buildAppManifest(business).icons?.[0]?.src).toBe(before);
    expect(buildAppManifest({ ...business, logoFileKey: "logos/2026/09/nuevo.png" }).icons?.[0]?.src).not.toBe(before);
    expect(buildAppManifest({ ...business, color: "#0f766e" }).icons?.[0]?.src).not.toBe(before);
    expect(buildAppManifest({ ...business, name: "Peluquería Aurora Norte" }).icons?.[0]?.src).not.toBe(before);
  });

  it("without a name or with a colour that is not #rrggbb, the defaults of DESIGN.md", () => {
    const manifest = buildAppManifest({ name: "   ", color: "rojo", logoFileKey: null });
    expect(manifest.name).toBe("DominIA Agentes");
    expect(manifest.theme_color).toBe("#3d6df2");
    expect(manifest.background_color).toBe("#3d6df2");
  });
});

describe("short name under the icon", () => {
  it.each([
    ["Aurora", "Aurora"],
    ["Peluquería Aurora", "Peluquería"],
    ["Clínica Dental Lumen", "Clínica"],
    ["Fisioterapeutas Asociados", "Fisioterapeu"],
  ])("«%s» → «%s»", (name, expected) => {
    expect(shortAppName(name)).toBe(expected);
  });
});
