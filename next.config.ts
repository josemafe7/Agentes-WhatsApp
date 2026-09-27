import type { NextConfig } from "next";

// Security headers for every route (docs/security.md, «Configuración», [SEG-11]). The Content-Security-Policy of the
// pages is not here: src/proxy.ts sets it on each page with a nonce of its own, and a second policy from here would
// also apply and block those scripts. If a route ever has to be framed (for example a widget iframe), it needs its own
// frame-ancestors rule. Nothing here may stop /widget.js from loading on the business's own site (no
// Cross-Origin-Resource-Policy or -Embedder-Policy for every route).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The app's own pages send their full address to the app (the widget API knows /widget-demo by it); other sites
  // get only the origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Microphone stays allowed for our own origin: voice notes from the inbox and the widget of /widget-demo.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  // Browsers only keep it from HTTPS answers. «preload» alone joins no list: asking the browsers to preload the domain
  // (hstspreload.org, for the main domain) stays the business's decision.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Pages opened from ours (or ours opened by others) get no handle on each other's window.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// The service worker of the PWA (Next.js PWA guide): always fresh, and allowed only this origin's scripts.
const serviceWorkerHeaders = [
  { key: "Content-Type", value: "application/javascript; charset=utf-8" },
  { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
  { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
];

/** docs/ files shown in Ayuda (src/app/(app)/ayuda/_lib/guides.ts). */
const HELP_GUIDE_FILES = ["./docs/guia-*.md", "./docs/checklist-puesta-en-marcha.md"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // In development Next.js prints every Server Function call with its arguments: the sign-in password, the
  // OpenRouter key typed in the wizard, 2FA codes… Logs never carry secrets ([SEG-02], [SEG-14]).
  logging: { serverFunctions: false },
  // Files a person attaches in the inbox go through a Server Action ([BAN-14], at most 3.5 MB plus the form's own
  // bytes): the default 1 MB would refuse most photos. Still under Vercel's 4.5 MB body limit.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // pino (imapflow) is externalized by Next.js already. ffmpeg-static resolves its binary from __dirname, so it must be
  // loaded with Node's require (docs/plataforma-despliegue.md). PGlite and its pgvector extension load their WebAssembly
  // and data files from their own package folders, so they are not bundled either.
  serverExternalPackages: ["ffmpeg-static", "@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  // The FFmpeg binary is not imported, so file tracing misses it: include it in the API routes that run tick()
  // (cron, webhooks, widget). Unverified on Vercel with pnpm symlinks: check the .nft.json at the deploy phase.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/ffmpeg-static/ffmpeg*"],
    // The guides of Ayuda are read from docs/ on the server: they go with the compiled app ([AJU-17]).
    "/ayuda": HELP_GUIDE_FILES,
    "/ayuda/*": HELP_GUIDE_FILES,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sw.js", headers: serviceWorkerHeaders },
    ];
  },
};

export default nextConfig;
