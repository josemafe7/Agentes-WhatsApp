import type { NextConfig } from "next";

// Security headers for every route (docs/security.md, «Configuración»). CSP comes in phase 7.
// If a route ever has to be framed (for example a widget iframe), it needs its own frame-ancestors rule.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Microphone stays allowed for our own origin: voice notes from the inbox.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
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
  // @libsql/client, libsql and pino (imapflow) are externalized by Next.js already. ffmpeg-static resolves its
  // binary from __dirname, so it must be loaded with Node's require (docs/plataforma-despliegue.md).
  serverExternalPackages: ["ffmpeg-static"],
  // The FFmpeg binary is not imported, so file tracing misses it: include it in the API routes that run tick()
  // (cron, webhooks, widget). Unverified on Vercel with pnpm symlinks: check the .nft.json at the deploy phase.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/ffmpeg-static/ffmpeg*"],
    // The guides of Ayuda are read from docs/ on the server: they go with the compiled app ([AJU-17]).
    "/ayuda": HELP_GUIDE_FILES,
    "/ayuda/*": HELP_GUIDE_FILES,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
