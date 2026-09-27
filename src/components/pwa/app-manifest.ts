// The web app manifest of the installation ([PWA-01], docs/notificaciones-push.md «Manifiesto»): the team installs
// the app with the business name, colour and icon, and it opens on the inbox. Pure: src/app/manifest.ts feeds it the
// settings of each request.
import type { MetadataRoute } from "next";
import { DEFAULT_BUSINESS_NAME, INBOX_PATH } from "@/components/app-shell/home-destination";
import { DEFAULT_BRAND_COLOR, isValidHex } from "@/lib/color";
import { appIconUrl, appIconVersion } from "./app-icon";

/** Launchers show about 12 characters under the icon. */
const SHORT_NAME_MAX = 12;

/** The name under the icon: the whole name if it fits, else the words that fit (or the start of the first one). */
export function shortAppName(name: string): string {
  const characters = (text: string) => Array.from(text).length;
  if (characters(name) <= SHORT_NAME_MAX) return name;
  let result = "";
  for (const word of name.split(/\s+/)) {
    const next = result ? `${result} ${word}` : word;
    if (characters(next) > SHORT_NAME_MAX) break;
    result = next;
  }
  return result || Array.from(name).slice(0, SHORT_NAME_MAX).join("");
}

export function buildAppManifest(business: { name: string; color: string; logoFileKey: string | null }): MetadataRoute.Manifest {
  const name = business.name.trim() || DEFAULT_BUSINESS_NAME;
  const color = isValidHex(business.color) ? business.color.toLowerCase() : DEFAULT_BRAND_COLOR;
  const version = appIconVersion({ name, color, logoFileKey: business.logoFileKey });
  return {
    id: "/",
    name,
    short_name: shortAppName(name),
    description: `Bandeja, agenda y avisos de ${name}.`,
    lang: "es",
    dir: "ltr",
    start_url: INBOX_PATH,
    scope: "/",
    // standalone: the only way iPhone and iPad receive push (iOS/iPadOS 16.4+, added to the home screen).
    display: "standalone",
    background_color: color,
    theme_color: color,
    icons: [
      { src: appIconUrl(192, "any", version), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: appIconUrl(512, "any", version), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: appIconUrl(512, "maskable", version), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
