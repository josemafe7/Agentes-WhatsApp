// Helpers against the app under test: saved sessions, the cron tick and extra browser contexts. Signing in is done
// through the form, as a person does: Better Auth's sign-in endpoint is closed over HTTP (src/server/auth.ts).
import path from "node:path";
import type { APIRequestContext, Browser, BrowserContext, TestInfo } from "@playwright/test";
import { TEST_SECRETS } from "./env";
import type { RoleKey } from "./users";

/** Session files written by e2e/demo/auth.setup.ts (test-results/ is git-ignored and cleaned on every run). */
export function authStatePath(role: RoleKey): string {
  return path.resolve(__dirname, "..", "..", "test-results", ".auth", `${role}.json`);
}

/**
 * Runs the background queue now (the local ticker does not exist under `next start`). The tick itself runs
 * after the 202 answer, so callers poll for its effect.
 */
export async function triggerTick(request: APIRequestContext, baseURL: string): Promise<void> {
  const response = await request.post(`${baseURL}/api/cron/tick`, {
    headers: { authorization: `Bearer ${TEST_SECRETS.CRON_SECRET}` },
    failOnStatusCode: false,
  });
  if (response.status() >= 300) throw new Error(`POST /api/cron/tick → ${response.status()}`);
}

/**
 * A second, independent browser (another person on another device) with the project's address, language and
 * time zone, its own client IP and, optionally, a saved session.
 */
export async function newPersonContext(
  browser: Browser,
  testInfo: TestInfo,
  options: { clientIp: string; storageState?: string },
): Promise<BrowserContext> {
  const use = testInfo.project.use;
  return browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    timezoneId: use.timezoneId,
    viewport: use.viewport,
    userAgent: use.userAgent,
    extraHTTPHeaders: { "x-forwarded-for": options.clientIp },
    storageState: options.storageState,
  });
}
