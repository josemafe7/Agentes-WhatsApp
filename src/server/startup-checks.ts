// What every server process checks before doing anything: the web server (src/instrumentation.ts) and `pnpm worker`
// (scripts/worker.ts). [SEG-03]: without a usable APP_ENCRYPTION_KEY it does not start and says why. A compiled app
// (NODE_ENV=production) does not start either without an https APP_URL (or http://localhost, on this computer only), with
// the address of an external service changed or with the HTTP tools let into the local network (only the Playwright
// servers may, with E2E_ALLOW_BASE_URL_OVERRIDES=true), nor anywhere with an invalid TRUSTED_PROXY_HOPS
// (docs/security.md «Configuración»). The messages name the variables, never their values.
import "server-only";
import { assertProductionConfig, ProductionConfigError, productionConfigWarnings } from "./app-url";
import { assertTrustedProxyHopsConfigured, TrustedProxyHopsError } from "./client-ip";
import { assertEncryptionKeyConfigured, EncryptionKeyError } from "./crypto";

/** A configuration this process must not run with; its message is safe to print. */
export function isStartupConfigError(error: unknown): error is Error {
  return error instanceof EncryptionKeyError || error instanceof ProductionConfigError || error instanceof TrustedProxyHopsError;
}

/**
 * Throws when this process must not start. `building` (`next build`): the address is checked when the compiled app
 * starts, not while it compiles. Returns what it should still say when it starts.
 */
export function checkStartupConfig(options: { building?: boolean } = {}): string[] {
  assertEncryptionKeyConfigured();
  assertTrustedProxyHopsConfigured();
  if (options.building) return [];
  assertProductionConfig();
  return productionConfigWarnings();
}
