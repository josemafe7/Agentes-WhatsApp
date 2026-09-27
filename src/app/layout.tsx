import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { connection } from "next/server";
import { AppToaster } from "@/components/app-toaster";
import { appIconUrl } from "@/components/pwa/app-icon";
import { buildAppManifest } from "@/components/pwa/app-manifest";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadBusinessSettings } from "@/data/settings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const BASE_METADATA: Metadata = {
  title: { default: "DominIA Agentes", template: "%s · DominIA Agentes" },
  description: "Agentes de IA de atención al cliente por WhatsApp, correo y chat web.",
};

/**
 * The icon iPhone and iPad use when the app is added to the home screen ([PWA-01]): they read this link, not the
 * manifest. The same icon as the manifest's, with its version (name, colour and logo of the business).
 */
export async function generateMetadata(): Promise<Metadata> {
  // Reads the database: only at request time, never while `next build` tries to prerender.
  await connection();
  let url = appIconUrl(192, "any");
  try {
    const { name, color, logoFileKey } = await loadBusinessSettings();
    url = buildAppManifest({ name, color, logoFileKey }).icons?.[0]?.src ?? url;
  } catch {
    // Without the settings the icon is still there, only without its version.
  }
  return { ...BASE_METADATA, icons: { apple: [{ url, sizes: "192x192", type: "image/png" }] } };
}

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // This request's Content-Security-Policy nonce (src/proxy.ts), for the theme's inline script ([SEG-11]).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider nonce={nonce}>
          <TooltipProvider>
            {children}
            <AppToaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
