// The `test` every spec imports: Playwright's, plus a client IP per test and the mock server client.
//
// Why a client IP: the compiled app rate-limits sign-in per IP ([USU-13], [SEG-07]) and every test comes from
// the same machine. Each test sends its own X-Forwarded-For (Next.js keeps a client-sent value and Better Auth
// reads it), so tests never trip each other's limits and one test can still prove that the limit exists.
import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";
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
});

export { expect } from "@playwright/test";
