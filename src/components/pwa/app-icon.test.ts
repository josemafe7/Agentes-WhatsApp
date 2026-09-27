import { describe, expect, it } from "vitest";
import { appIconSpec, appIconUrl, parseAppIconQuery } from "./app-icon";

const business = { name: "Peluquería Aurora", color: "#b4235a" };

describe("icon of the installed app [PWA-01]", () => {
  it("without a logo: the business initials on its colour, in the colour that reads best", () => {
    expect(appIconSpec(business, 192, "any", false)).toMatchObject({ initials: "PA", background: "#b4235a", foreground: "#ffffff" });
    expect(appIconSpec({ name: "Sol", color: "#ffd400" }, 192, "any", false)).toMatchObject({ initials: "S", foreground: "#0a0a0a" });
  });

  it("with a logo: the logo on white, inside the icon", () => {
    const spec = appIconSpec(business, 512, "any", true);
    expect(spec.background).toBe("#ffffff");
    expect(spec.logoSize).toBeGreaterThan(256);
    expect(spec.logoSize).toBeLessThan(512);
  });

  it("a maskable icon keeps its content inside the safe circle (80 % of the icon)", () => {
    for (const withLogo of [true, false]) {
      const spec = appIconSpec(business, 512, "maskable", withLogo);
      // A square fits in the circle when its side is at most 0.8 / √2 of the icon.
      expect(spec.logoSize).toBeLessThanOrEqual(Math.floor((512 * 0.8) / Math.SQRT2));
      expect(spec.fontSize).toBeLessThan(appIconSpec(business, 512, "any", withLogo).fontSize);
    }
  });

  it("an invalid colour draws the default DominIA blue", () => {
    expect(appIconSpec({ name: "", color: "azul" }, 192, "any", false)).toMatchObject({ background: "#3d6df2", initials: "DA" });
  });

  it("only the sizes and looks the manifest asks for are drawn", () => {
    expect(parseAppIconQuery(new URLSearchParams("size=192"))).toEqual({ size: 192, purpose: "any" });
    expect(parseAppIconQuery(new URLSearchParams("size=512&purpose=maskable&v=abc"))).toEqual({ size: 512, purpose: "maskable" });
    expect(parseAppIconQuery(new URLSearchParams("size=100"))).toBeNull();
    expect(parseAppIconQuery(new URLSearchParams("size=512&purpose=monochrome"))).toBeNull();
    expect(parseAppIconQuery(new URLSearchParams(""))).toBeNull();
  });

  it("builds the address the manifest and the service worker use", () => {
    expect(appIconUrl(192, "any")).toBe("/api/push/icon?size=192");
    expect(appIconUrl(512, "maskable", "k3x")).toBe("/api/push/icon?size=512&purpose=maskable&v=k3x");
  });
});
