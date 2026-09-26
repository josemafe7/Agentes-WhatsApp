import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRAND_COLOR,
  contrastForeground,
  contrastRatio,
  deltaEOk,
  isValidHex,
  primaryCssVars,
  primaryStyleSheet,
} from "./color";

// Surfaces from DESIGN.md: --muted is the least favourable surface of each theme.
const LIGHT_MUTED = "#f4f4f5";
const DARK_MUTED = "#27272a";
// Values verified with the WCAG formula in DESIGN.md › Colors › Color del negocio.
const JUST_NOTICEABLE = 0.02;

describe("[AJU-01] business colour: validation", () => {
  it("accepts #rrggbb in any case", () => {
    expect(isValidHex("#3d6df2")).toBe(true);
    expect(isValidHex("#3D6DF2")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["3d6df2", "#3d6", "#3d6df2ff", "#zzzzzz", "", " #3d6df2", null, undefined, 42]) {
      expect(isValidHex(value)).toBe(false);
    }
  });
});

describe("WCAG contrast", () => {
  it("computes the ratio with the WCAG formula", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#3d6df2", "#ffffff")).toBeCloseTo(4.499, 3);
    expect(contrastRatio("#ffffff", "#3c6cf1")).toBeCloseTo(4.56, 2);
  });

  it("contrastForeground prefers white when it reaches 4.5:1", () => {
    expect(contrastForeground("#1e2a4a")).toBe("#ffffff");
    expect(contrastForeground("#3c6cf1")).toBe("#ffffff");
  });

  it("contrastForeground picks near-black on light colours", () => {
    expect(contrastForeground("#ffd400")).toBe("#0a0a0a");
    expect(contrastForeground("#f4f4f5")).toBe("#0a0a0a");
  });

  it("contrastForeground returns the higher-contrast option when neither reaches 4.5:1", () => {
    // White gives 4.499:1 on the DominIA blue; near-black gives less.
    expect(contrastForeground("#3d6df2")).toBe("#ffffff");
  });
});

describe("[AJU-01] primaryCssVars: default colour #3d6df2", () => {
  const vars = primaryCssVars(DEFAULT_BRAND_COLOR);

  it("darkens the blue a hair so white text reaches 4.5:1 (light and dark)", () => {
    expect(vars.light["--primary"]).toBe("#3c6cf1");
    expect(vars.light["--primary-foreground"]).toBe("#ffffff");
    expect(vars.dark["--primary"]).toBe("#3c6cf1");
    expect(vars.dark["--primary-foreground"]).toBe("#ffffff");
  });

  it("mixes the soft background with the page background (10 % light, 20 % dark)", () => {
    expect(vars.light["--primary-soft"]).toBe("#eaf1ff");
    expect(vars.dark["--primary-soft"]).toBe("#131b31");
  });

  it("gives --primary-text close to the documented values", () => {
    expect(deltaEOk(vars.light["--primary-text"], "#3462e6")).toBeLessThan(JUST_NOTICEABLE);
    expect(deltaEOk(vars.dark["--primary-text"], "#5a89fe")).toBeLessThan(JUST_NOTICEABLE);
  });

  it("reuses --primary for ring, sidebar and first chart series", () => {
    for (const theme of [vars.light, vars.dark]) {
      expect(theme["--ring"]).toBe(theme["--primary"]);
      expect(theme["--sidebar-primary"]).toBe(theme["--primary"]);
      expect(theme["--sidebar-primary-foreground"]).toBe(theme["--primary-foreground"]);
      expect(theme["--chart-1"]).toBe(theme["--primary"]);
    }
  });
});

describe("[AJU-01] primaryCssVars: other colours from the DESIGN.md table", () => {
  it("yellow #ffd400: darkened in light with black text; untouched in dark", () => {
    const { light, dark } = primaryCssVars("#ffd400");
    expect(deltaEOk(light["--primary"], "#a88b09")).toBeLessThan(JUST_NOTICEABLE);
    expect(light["--primary-foreground"]).toBe("#000000");
    expect(contrastRatio(light["--primary"], "#000000")).toBeCloseTo(6.36, 1);
    expect(dark["--primary"]).toBe("#ffd400");
    expect(dark["--primary-foreground"]).toBe("#000000");
    expect(contrastRatio(dark["--primary"], "#000000")).toBeCloseTo(14.67, 2);
    expect(deltaEOk(light["--primary-text"], "#846d01")).toBeLessThan(JUST_NOTICEABLE);
    expect(dark["--primary-text"]).toBe("#ffd400");
  });

  it("navy #1e2a4a: untouched in light; lightened in dark", () => {
    const { light, dark } = primaryCssVars("#1e2a4a");
    expect(light["--primary"]).toBe("#1e2a4a");
    expect(light["--primary-foreground"]).toBe("#ffffff");
    expect(contrastRatio(light["--primary"], "#ffffff")).toBeCloseTo(14.14, 2);
    expect(dark["--primary"]).toBe("#617095");
    expect(contrastRatio(dark["--primary"], "#ffffff")).toBeCloseTo(4.93, 2);
    expect(light["--primary-text"]).toBe("#1e2a4a");
    expect(deltaEOk(dark["--primary-text"], "#7e8eb4")).toBeLessThan(JUST_NOTICEABLE);
  });
});

describe("[AJU-01] primaryCssVars always meets WCAG AA", () => {
  const samples = ["#3d6df2", "#ffd400", "#1e2a4a", "#ffffff", "#000000", "#ff0000", "#00ff00", "#7008e7", "#f4f4f5", "#27272a", "#808080", "#00bcff"];

  it.each(samples)("%s", (color) => {
    const { light, dark } = primaryCssVars(color);
    for (const [theme, muted] of [[light, LIGHT_MUTED], [dark, DARK_MUTED]] as const) {
      expect(contrastRatio(theme["--primary"], muted)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme["--primary"], theme["--primary-foreground"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme["--primary-text"], muted)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme["--primary-text"], theme["--primary-soft"])).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("[AJU-01] invalid or missing colour falls back to #3d6df2", () => {
  it.each([null, undefined, "", "blue", "#12345"])("%s", (value) => {
    expect(primaryCssVars(value)).toEqual(primaryCssVars(DEFAULT_BRAND_COLOR));
  });
});

describe("primaryStyleSheet", () => {
  it("renders :root and .dark blocks with only hex values", () => {
    const css = primaryStyleSheet("#3d6df2");
    expect(css).toContain(":root{--primary:#3c6cf1;");
    expect(css).toContain(".dark{--primary:#3c6cf1;");
    // Nothing but variable names and hex colours: safe to inline in a <style> tag.
    expect(css).toMatch(/^[:.a-z{}\-;#0-9]+$/);
  });
});
