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

// ─── Start-up checks of a published app (src/instrumentation.ts) ──────────────────────────────────────────

/** Where the clients of the external services send their requests; only the tests point them at their mock. */
export const BASE_URL_OVERRIDE_VARIABLES = [
  "META_GRAPH_BASE_URL",
  "OPENROUTER_BASE_URL",
  "GOOGLE_OAUTH_BASE_URL",
  "GOOGLE_API_BASE_URL",
  "MS_LOGIN_BASE_URL",
  "MS_GRAPH_BASE_URL",
  "MISTRAL_BASE_URL",
  "TELEGRAM_API_BASE_URL",
] as const;

/** Set to "true" only by playwright.config.ts for its app servers (compiled app, mock services, http://localhost). */
export const E2E_OVERRIDES_FLAG = "E2E_ALLOW_BASE_URL_OVERRIDES";
/** Lets the HTTP tools reach this machine and its network (src/server/ai/tools/http-tool.ts): development and tests only. */
export const LOCAL_HTTP_TOOLS_VARIABLE = "ALLOW_LOCAL_HTTP_TOOLS";

const APP_URL_VARIABLES = ["APP_URL", "BETTER_AUTH_URL"] as const;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

type Env = Readonly<Record<string, string | undefined>>;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** http:// on this machine (localhost, 127.0.0.1 or [::1]): the compiled app tried in the same computer. */
function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * An absolute https:// address without user or password, or plain http on this machine: `pnpm build && pnpm start` in
 * the same computer (the browser only talks to itself, and Better Auth refuses sign-ins from any other origin).
 */
function isAcceptedAppUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url || url.username || url.password) return false;
  return url.protocol === "https:" || isLoopbackHttp(url);
}

/**
 * Why a published app (NODE_ENV=production) must not start, in Spanish; empty when it may. Names the variables,
 * never their values. Without an https address Better Auth would build sign-in and reset links from whatever host a
 * request claims and would not mark the cookies Secure; a changed *_BASE_URL would send the business's keys and its
 * customers' messages to another server.
 */
export function productionConfigProblems(env: Env = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const e2e = env[E2E_OVERRIDES_FLAG]?.trim() === "true";
  const problems: string[] = [];

  const urls = APP_URL_VARIABLES.map((name) => ({ name, value: env[name]?.trim() ?? "" })).filter((entry) => entry.value !== "");
  if (urls.length === 0) {
    problems.push(
      "Falta APP_URL: pon en APP_URL y en BETTER_AUTH_URL la dirección pública de la app, con https:// (docs/guia-despliegue.md).",
    );
  }
  for (const { name, value } of urls) {
    if (!isAcceptedAppUrl(value)) {
      problems.push(
        `${name} tiene que ser la dirección pública de la app con https://, sin usuario ni contraseña (por ejemplo ` +
          "https://agentes.tunegocio.es). Solo en tu propio ordenador sirve http://localhost.",
      );
    }
  }

  const overrides = BASE_URL_OVERRIDE_VARIABLES.filter((name) => (env[name]?.trim() ?? "") !== "");
  if (overrides.length > 0 && !e2e) {
    problems.push(
      `En una instalación publicada no se pueden cambiar las direcciones de los servicios externos: quita ${overrides.join(", ")}. ` +
        `Solo las pruebas de Playwright las cambian, con ${E2E_OVERRIDES_FLAG}=true.`,
    );
  }

  // [HER-14]: a published app's HTTP tools never reach the server's own network.
  if (env[LOCAL_HTTP_TOOLS_VARIABLE]?.trim().toLowerCase() === "true" && !e2e) {
    problems.push(
      `En una instalación publicada las herramientas HTTP solo llaman a servicios públicos con https://: quita ${LOCAL_HTTP_TOOLS_VARIABLE}. ` +
        "Solo sirve con pnpm dev y en las pruebas de Playwright.",
    );
  }
  return problems;
}

/**
 * What a compiled app that may start should still say when it starts (NODE_ENV=production): with http://localhost it
 * only works in this computer. Names the variables, never their values.
 */
export function productionConfigWarnings(env: Env = process.env): string[] {
  if (env.NODE_ENV !== "production" || env[E2E_OVERRIDES_FLAG]?.trim() === "true") return [];
  const local = APP_URL_VARIABLES.filter((name) => {
    const url = parseUrl(env[name]?.trim() ?? "");
    return url !== null && isLoopbackHttp(url);
  });
  if (local.length === 0) return [];
  return [
    `${local.join(" y ")} usa http://localhost: la versión compilada solo se puede usar en este ordenador. Para publicarla, ` +
      "pon la dirección pública de la app con https:// (docs/guia-despliegue.md).",
  ];
}

export class ProductionConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(problems.join(" "));
    this.name = "ProductionConfigError";
  }
}

/** Throws ProductionConfigError when productionConfigProblems() finds anything. */
export function assertProductionConfig(env: Env = process.env): void {
  const problems = productionConfigProblems(env);
  if (problems.length > 0) throw new ProductionConfigError(problems);
}
