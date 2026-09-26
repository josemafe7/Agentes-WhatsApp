// Business colour maths from DESIGN.md › Colors › Color del negocio: WCAG contrast and OKLCH adjustments.
// Pure functions (no DOM), shared by the root layout, Settings › Negocio and the web chat widget.

export const DEFAULT_BRAND_COLOR = "#3d6df2";

const WHITE = "#ffffff";
const NEAR_BLACK = "#0a0a0a";
// Pure black: with white failing 4.5:1, black always passes (the two contrasts multiply to 21).
const BLACK = "#000000";

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;
// Largest invisible darkening tried so white text fits on the primary colour (OKLCH lightness).
const MAX_FOREGROUND_DARKENING = 0.06;
const LIGHTNESS_STEP = 0.001;

type Rgb = [number, number, number];
type Oklab = [number, number, number];
type ThemeName = "light" | "dark";

/** CSS variables that depend on the business colour, for one theme. */
export type PrimaryThemeVars = {
  "--primary": string;
  "--primary-foreground": string;
  "--primary-text": string;
  "--primary-soft": string;
  "--ring": string;
  "--sidebar-primary": string;
  "--sidebar-primary-foreground": string;
  "--sidebar-ring": string;
  "--chart-1": string;
};

type ThemeSurface = { background: string; muted: string; direction: 1 | -1; softMix: number };

// Surfaces of each theme (globals.css). direction: -1 darkens (light theme), +1 lightens (dark theme).
const THEMES: Record<ThemeName, ThemeSurface> = {
  light: { background: "#ffffff", muted: "#f4f4f5", direction: -1, softMix: 0.1 },
  dark: { background: "#09090b", muted: "#27272a", direction: 1, softMix: 0.2 },
};

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

/** True for a #rrggbb colour. */
export function isValidHex(value: unknown): value is string {
  return typeof value === "string" && HEX_PATTERN.test(value);
}

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${rgb.map(channel).join("")}`;
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Text colour for a background: white when it reaches 4.5:1, otherwise whichever of the two contrasts more. */
export function contrastForeground(hex: string): "#ffffff" | "#0a0a0a" {
  const onWhite = contrastRatio(hex, WHITE);
  if (onWhite >= AA_TEXT) return WHITE;
  return contrastRatio(hex, NEAR_BLACK) > onWhite ? NEAR_BLACK : WHITE;
}

// OKLab (Björn Ottosson) from linear sRGB and back.
function hexToOklab(hex: string): Oklab {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([lightness, a, b]: Oklab): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearRgbToHex(rgb: Rgb): string {
  return rgbToHex(rgb.map((value) => fromLinear(Math.min(1, Math.max(0, value)))) as Rgb);
}

const GAMUT_EPSILON = 1e-6;

function isInGamut(rgb: Rgb): boolean {
  return rgb.every((value) => value >= -GAMUT_EPSILON && value <= 1 + GAMUT_EPSILON);
}

/** OKLab distance between two colours (0.02 is about one just-noticeable difference). */
export function deltaEOk(a: string, b: string): number {
  const [l1, a1, b1] = hexToOklab(a);
  const [l2, a2, b2] = hexToOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// Colour with a new OKLCH lightness and the same hue; chroma is reduced until it fits in sRGB.
function withLightness(hex: string, lightness: number): string {
  const [, a, b] = hexToOklab(hex);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);
  const at = (c: number): Rgb => oklabToLinearRgb([lightness, c * Math.cos(hue), c * Math.sin(hue)]);
  if (isInGamut(at(chroma))) return linearRgbToHex(at(chroma));
  let low = 0;
  let high = chroma;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    if (isInGamut(at(mid))) low = mid;
    else high = mid;
  }
  return linearRgbToHex(at(low));
}

// Smallest lightness change (in `direction`, up to `maxDelta`) that makes `accept` true; null if none does.
function adjustLightness(
  hex: string,
  direction: 1 | -1,
  accept: (candidate: string) => boolean,
  maxDelta = 1,
): string | null {
  if (accept(hex)) return hex;
  const [lightness] = hexToOklab(hex);
  for (let delta = LIGHTNESS_STEP; delta <= maxDelta + GAMUT_EPSILON; delta += LIGHTNESS_STEP) {
    const target = lightness + direction * delta;
    if (target < 0 || target > 1) break;
    const candidate = withLightness(hex, target);
    if (accept(candidate)) return candidate;
  }
  return null;
}

// Mix `amount` of colour `a` into `b` in OKLab (same as CSS color-mix(in oklab, a amount, b)).
function mixOklab(a: string, b: string, amount: number): string {
  const labA = hexToOklab(a);
  const labB = hexToOklab(b);
  const mixed = labA.map((value, i) => value * amount + labB[i] * (1 - amount)) as Oklab;
  return linearRgbToHex(oklabToLinearRgb(mixed));
}

function themeVars(brand: string, surface: ThemeSurface): PrimaryThemeVars {
  // 1. Primary reaches 3:1 against the least favourable surface.
  let primary =
    adjustLightness(brand, surface.direction, (c) => contrastRatio(c, surface.muted) >= AA_NON_TEXT) ??
    (surface.direction === -1 ? BLACK : WHITE);

  // 2. White text if it reaches 4.5:1, darkening the primary a little if needed; otherwise black.
  let foreground = WHITE;
  if (contrastRatio(primary, WHITE) < AA_TEXT) {
    const darker = adjustLightness(
      primary,
      -1,
      (c) => contrastRatio(c, WHITE) >= AA_TEXT && contrastRatio(c, surface.muted) >= AA_NON_TEXT,
      MAX_FOREGROUND_DARKENING,
    );
    if (darker) primary = darker;
    else foreground = BLACK;
  }

  // 4. Soft background (selected rows, active chips).
  const soft = mixOklab(primary, surface.background, surface.softMix);

  // 3. Accent text reaches 4.5:1 on the muted surface and on the soft background.
  const text =
    adjustLightness(
      primary,
      surface.direction,
      (c) => contrastRatio(c, surface.muted) >= AA_TEXT && contrastRatio(c, soft) >= AA_TEXT,
    ) ?? (surface.direction === -1 ? BLACK : WHITE);

  // 5. Ring, sidebar and first chart series reuse the primary.
  return {
    "--primary": primary,
    "--primary-foreground": foreground,
    "--primary-text": text,
    "--primary-soft": soft,
    "--ring": primary,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": foreground,
    "--sidebar-ring": primary,
    "--chart-1": primary,
  };
}

/** CSS variables for the business colour in light and dark themes; invalid input uses #3d6df2. */
export function primaryCssVars(hex: string | null | undefined): Record<ThemeName, PrimaryThemeVars> {
  const brand = isValidHex(hex) ? hex.toLowerCase() : DEFAULT_BRAND_COLOR;
  return { light: themeVars(brand, THEMES.light), dark: themeVars(brand, THEMES.dark) };
}

/** `:root{…}.dark{…}` block for a <style> tag in the root layout; values are always #rrggbb. */
export function primaryStyleSheet(hex: string | null | undefined): string {
  const { light, dark } = primaryCssVars(hex);
  const block = (vars: PrimaryThemeVars) =>
    Object.entries(vars)
      .map(([name, value]) => `${name}:${value};`)
      .join("");
  return `:root{${block(light)}}.dark{${block(dark)}}`;
}
