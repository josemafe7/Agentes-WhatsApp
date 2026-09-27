// Better Auth 1.7.5 (docs/decisions/0004): email + password with public sign-up closed, password reset through
// the system mail, optional TOTP (twoFactor plugin) and a database-backed rate limit on /api/auth/*.
// Users are created only by src/server/accounts.ts (setup wizard, invitations, seed).
import "server-only";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { db } from "@/db";
import { account, rateLimit, session, twoFactor as twoFactorTable, user, verification } from "@/db/schema";
import { getJobQueue } from "./adapters/job-queue";
import { PASSWORD_RESET_TTL_SECONDS } from "./email-templates";
import { SYSTEM_EMAIL_JOB, type SystemEmailJobPayload } from "./jobs/handlers/system-email";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/validation";

export const APP_NAME = "DominIA Agentes";
/** Cookies are called dominia.session_token (and __Secure-dominia.… over HTTPS). */
export const AUTH_COOKIE_PREFIX = "dominia";
const DAY_SECONDS = 24 * 60 * 60;
const SYSTEM_EMAIL_MAX_ATTEMPTS = 3;

function authBaseUrl(): string | undefined {
  return process.env.BETTER_AUTH_URL?.trim() || process.env.APP_URL?.trim() || undefined;
}

/** Origins allowed to call /api/auth/* (Better Auth also trusts its own baseURL). */
function trustedOrigins(): string[] {
  const origins = new Set<string>();
  for (const value of [process.env.APP_URL, process.env.BETTER_AUTH_URL]) {
    if (!value?.trim()) continue;
    try {
      origins.add(new URL(value.trim()).origin);
    } catch {
      console.warn("[auth] APP_URL o BETTER_AUTH_URL no es una URL válida y se ignora.");
    }
  }
  return [...origins];
}

const baseURL = authBaseUrl();

/** Where the Better Auth router lives (src/app/api/auth/[...all]/route.ts). */
const AUTH_BASE_PATH = "/api/auth";

/**
 * The only Better Auth endpoints reachable over HTTP. Signing in, the two-step code, password reset and «Mi
 * cuenta» go through Server Actions (auth.api.*), which add our limits per email and per user, the activity log
 * and our own validation; straight over HTTP they would skip all of that ([USU-13], [SEG-05], [SEG-07], [SEG-10]).
 * Anything else, including endpoints a future Better Auth version adds, answers 404.
 */
const HTTP_ENDPOINTS: readonly { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/get-session$/ },
  { method: "POST", path: /^\/sign-out$/ },
  // The link of the password reset email: checks the token and sends to /restablecer ([USU-10]).
  { method: "GET", path: /^\/reset-password\/[^/]+$/ },
];

function isOpenOverHttp(method: string, pathname: string): boolean {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return false;
  const path = pathname.slice(AUTH_BASE_PATH.length).replace(/\/+$/, "");
  return HTTP_ENDPOINTS.some((endpoint) => endpoint.method === method && endpoint.path.test(path));
}

/** Closes every endpoint not in HTTP_ENDPOINTS. Only the HTTP router runs onRequest: auth.api.* is not affected. */
const httpAllowlist: BetterAuthPlugin = {
  id: "http-allowlist",
  onRequest: async (request) => {
    if (isOpenOverHttp(request.method, new URL(request.url).pathname)) return;
    return { response: new Response("Not Found", { status: 404 }) };
  },
};

export const auth = betterAuth({
  appName: APP_NAME,
  baseURL,
  basePath: AUTH_BASE_PATH,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: trustedOrigins(),
  database: drizzleAdapter(db, {
    provider: "sqlite",
    // Keys are Better Auth's model names; values are our Drizzle tables.
    schema: { user, session, account, verification, twoFactor: twoFactorTable, rateLimit },
  }),
  emailAndPassword: {
    enabled: true,
    // No public sign-up ([USU-03]): this also blocks auth.api.signUpEmail on the server.
    disableSignUp: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    requireEmailVerification: false,
    resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_SECONDS,
    // Changing the password closes the other sessions ([USU-10]).
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user: account, url }) => {
      // Queued, not sent here: the answer takes the same time whether the email exists or not ([USU-10]). The job
      // forgets the link as soon as the email is sent (src/server/jobs/handlers/system-email.ts).
      const payload: SystemEmailJobPayload = { template: "password_reset", to: account.email, name: account.name, url };
      await getJobQueue().enqueue({ type: SYSTEM_EMAIL_JOB, payload, maxAttempts: SYSTEM_EMAIL_MAX_ATTEMPTS });
    },
  },
  verification: {
    // One-time tokens (the password reset link, the two-step sign-in) are stored as their SHA-256, never as they are:
    // a copy of the database gives no working link ([USU-10], [SEG-02]). Better Auth hashes each lookup the same way.
    storeIdentifier: "hashed",
  },
  session: {
    expiresIn: 7 * DAY_SECONDS,
    updateAge: DAY_SECONDS,
    // No cookie cache: a deactivated or deleted user loses access on the next request ([USU-14]).
  },
  rateLimit: {
    // For the few endpoints still open over HTTP (httpAllowlist). On in every environment (Better Auth's default
    // is production only) and stored in the database, so it works across serverless instances ([SEG-07]).
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: { "/get-session": false },
  },
  advanced: {
    database: { generateId: "uuid" },
    cookiePrefix: AUTH_COOKIE_PREFIX,
    // Secure cookies (and the __Secure- prefix) whenever the app runs on HTTPS, i.e. in production.
    useSecureCookies: baseURL?.startsWith("https://") ?? process.env.NODE_ENV === "production",
  },
  plugins: [
    httpAllowlist,
    twoFactor({
      // Default issuer; enrolment passes the business name (getTotpIssuer in src/data/settings.ts).
      issuer: APP_NAME,
    }),
    // Must be the last plugin: lets Server Actions set the session cookie.
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
