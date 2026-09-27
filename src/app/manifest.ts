// /manifest.webmanifest ([PWA-01], docs/notificaciones-push.md «Manifiesto»). Next.js links it from every page. It is
// built from the business settings on each request: connection() keeps `next build` from freezing the name, colour
// and icon of that moment. Public, like the logo: src/proxy.ts never sends it to the login page.
import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { buildAppManifest } from "@/components/pwa/app-manifest";
import { loadBusinessSettings } from "@/data/settings";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  await connection();
  const { name, color, logoFileKey } = await loadBusinessSettings();
  return buildAppManifest({ name, color, logoFileKey });
}
