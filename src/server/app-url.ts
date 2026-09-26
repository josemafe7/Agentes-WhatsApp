// Public address of the installation, for links in emails, webhooks and OAuth redirects.
// Never VERCEL_URL: previews are behind Deployment Protection (docs/plataforma-despliegue.md).
import "server-only";

const LOCAL_URL = "http://localhost:3000";

export function getAppUrl(): string {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const url =
    process.env.APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    (productionHost ? `https://${productionHost}` : "") ||
    LOCAL_URL;
  return url.replace(/\/+$/, "");
}

/** Absolute URL of an in-app path. */
export function appUrl(path: string): string {
  return `${getAppUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
