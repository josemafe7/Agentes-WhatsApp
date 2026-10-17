// Data the envíos spec shares with e2e/support/create-campaign-fixtures.ts, which writes it into the demo database of the
// run right after the seed (e2e/support/prepare-databases.mjs). No imports: the fixture script runs with tsx, outside
// Playwright.

/**
 * A customer who got an envío by email, with its «Darme de baja» link ([ENV-11]). The test app has no public address, so
 * no envío goes by email during a run: this one is written as if it had gone. The token is a made-up value of the test
 * database only.
 */
export const UNSUBSCRIBE_FIXTURE = {
  contactName: "Cliente envío e2e",
  email: "envio-correo@e2e.test",
  campaignName: "Envío por correo e2e",
  token: "e2e-baja-token-0123456789abcdef",
} as const;
