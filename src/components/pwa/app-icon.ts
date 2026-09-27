// Look of the icon of the installed app and of its push notices ([PWA-01]): the business logo on white, or its
// initials on the business colour when there is no logo, the same fallback as the menu (DESIGN.md «Marca»).
// Pure: src/app/api/push/_lib/render-app-icon.tsx draws it and src/components/pwa/app-manifest.ts lists it.
import { businessInitials } from "@/components/app-shell/home-destination";
import { contrastForeground, DEFAULT_BRAND_COLOR, isValidHex } from "@/lib/color";

/** Public route that draws the icon (no session: the browser fetches it to install the app). */
export const APP_ICON_ROUTE = "/api/push/icon";

export const APP_ICON_SIZES = [192, 512] as const;
export type AppIconSize = (typeof APP_ICON_SIZES)[number];
/** «any» for launchers; «maskable» fills the whole shape the phone cuts it into. */
export const APP_ICON_PURPOSES = ["any", "maskable"] as const;
export type AppIconPurpose = (typeof APP_ICON_PURPOSES)[number];
export type AppIconQuery = { size: AppIconSize; purpose: AppIconPurpose };

const LOGO_BACKGROUND = "#ffffff";
// Share of the icon the content may take. A maskable icon is cut to a circle of 80 %, and a square fits inside it
// with a side of 0.8 / √2 ≈ 0.566 of the icon.
const CONTENT_SHARE: Record<AppIconPurpose, { logo: number; text: number }> = {
  any: { logo: 0.8, text: 0.42 },
  maskable: { logo: 0.56, text: 0.3 },
};

export type AppIconSpec = {
  size: AppIconSize;
  background: string;
  /** Colour of the initials. */
  foreground: string;
  initials: string;
  /** Side of the box the logo is fitted into. */
  logoSize: number;
  fontSize: number;
};

/** What the icon of `size` looks like, with the logo (`withLogo`) or with the initials. */
export function appIconSpec(business: { name: string; color: string }, size: AppIconSize, purpose: AppIconPurpose, withLogo: boolean): AppIconSpec {
  const color = isValidHex(business.color) ? business.color.toLowerCase() : DEFAULT_BRAND_COLOR;
  const share = CONTENT_SHARE[purpose];
  return {
    size,
    background: withLogo ? LOGO_BACKGROUND : color,
    foreground: contrastForeground(color),
    initials: businessInitials(business.name),
    logoSize: Math.floor(size * share.logo),
    fontSize: Math.round(size * share.text),
  };
}

/** The size and look asked for in the icon's address, or null for anything the manifest never asks for. */
export function parseAppIconQuery(params: URLSearchParams): AppIconQuery | null {
  const size = APP_ICON_SIZES.find((candidate) => String(candidate) === params.get("size"));
  const purpose = APP_ICON_PURPOSES.find((candidate) => candidate === (params.get("purpose") ?? "any"));
  return size && purpose ? { size, purpose } : null;
}

/** Address of the icon. `version` changes with the name, colour or logo, so browsers fetch the new one. */
export function appIconUrl(size: AppIconSize, purpose: AppIconPurpose, version?: string): string {
  const params = new URLSearchParams({ size: String(size) });
  if (purpose !== "any") params.set("purpose", purpose);
  if (version) params.set("v", version);
  return `${APP_ICON_ROUTE}?${params.toString()}`;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Short fingerprint of what the icon is drawn from (FNV-1a): not a secret, only a cache key. */
export function appIconVersion(business: { name: string; color: string; logoFileKey: string | null }): string {
  let hash = FNV_OFFSET;
  for (const char of `${business.name}|${business.color}|${business.logoFileKey ?? ""}`) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), FNV_PRIME) >>> 0;
  }
  return hash.toString(36);
}
