// The `test` every spec imports: Playwright's, plus a client IP per test, the mock server client and, for tests
// that need AI, an OpenRouter key saved in Ajustes › IA for the length of the test.
//
// Why a client IP: the compiled app rate-limits sign-in per IP ([USU-13], [SEG-07]) and every test comes from
// the same machine. Each test sends its own X-Forwarded-For (Next.js keeps a client-sent value and Better Auth
// reads it), so tests never trip each other's limits and one test can still prove that the limit exists.
import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";
import { OPENROUTER_TEST_KEYS, removeOpenRouterKey, saveOpenRouterKey } from "./ai";
import { authStatePath, newPersonContext } from "./app";
import { RUN_ID } from "./env";
import { MockClient } from "./mock-client";

/** A private-range IPv4 derived from `seed`: stable for a test, different between tests. */
export function clientIpFor(seed: string): string {
  const hash = createHash("sha256").update(`${RUN_ID}:${seed}`).digest();
  return `10.${hash[0]}.${hash[1]}.${(hash[2] % 254) + 1}`;
}

type Fixtures = {
  /** X-Forwarded-For of this test's browser and `request` (a retry gets a new one). */
  clientIp: string;
  /** The mock server, reset when a test asks for it. */
  mock: MockClient;
  /**
   * The valid test key, saved in Ajustes › IA by the demo owner (in a browser of their own) before the test and
   * removed after it, even when the test fails: the demo server otherwise runs without AI ([ARR-14]). The mock is
   * reset first. Demo project only (it uses the owner's saved session).
   */
  openRouterKey: string;
};

export const test = base.extend<Fixtures>({
  clientIp: async ({}, provide, testInfo) => {
    await provide(clientIpFor(`${testInfo.testId}:${testInfo.retry}:${testInfo.repeatEachIndex}`));
  },
  extraHTTPHeaders: async ({ extraHTTPHeaders, clientIp }, provide) => {
    await provide({ ...extraHTTPHeaders, "x-forwarded-for": clientIp });
  },
  mock: async ({}, provide) => {
    const mock = new MockClient();
    await mock.reset();
    await provide(mock);
  },
  openRouterKey: async ({ browser, mock }, provide, testInfo) => {
    // A test with AI always starts with the simulated OpenRouter clean: no stubs left by a test that failed.
    await mock.reset();
    const owner = await newPersonContext(browser, testInfo, {
      clientIp: clientIpFor(`${testInfo.testId}:${testInfo.retry}:openrouter-key`),
      storageState: authStatePath("owner"),
    });
    const page = await owner.newPage();
    try {
      await saveOpenRouterKey(page, OPENROUTER_TEST_KEYS.valid);
      await provide(OPENROUTER_TEST_KEYS.valid);
    } finally {
      await removeOpenRouterKey(page);
      await owner.close();
    }
  },
});

export { expect } from "@playwright/test";
