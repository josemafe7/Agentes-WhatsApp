// «¿Has olvidado tu contraseña?»: request of the reset link, with real Better Auth on this file's own database.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

import { db } from "@/db";
import { jobs } from "@/db/schema";
import { SYSTEM_EMAIL_JOB } from "@/server/jobs/handlers/system-email";
import { createBusiness, createUser } from "@/test/factories";
import { RESET_REQUESTED_MESSAGE, TOO_MANY_ATTEMPTS_MESSAGE } from "../_lib/messages";
import { nextTestIp } from "../_lib/test-helpers";
import { requestPasswordResetAction } from "./actions";

async function resetEmailsTo(email: string) {
  const rows = await db.select().from(jobs).where(eq(jobs.type, SYSTEM_EMAIL_JOB));
  return rows.filter((row) => (row.payload as { to?: string }).to === email);
}

beforeAll(async () => {
  await createBusiness();
});

beforeEach(() => {
  request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
});

describe("asking for a new password [USU-10]", () => {
  it("answers the same whether the email has an account or not", async () => {
    const member = await createUser("agent");
    const existing = await requestPasswordResetAction({ email: member.email });
    request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
    const missing = await requestPasswordResetAction({ email: "no-existe@example.com" });
    expect(existing).toEqual({ ok: true, message: RESET_REQUESTED_MESSAGE });
    expect(missing).toEqual(existing);
  });

  it("only a real account gets the email, with a one-time link back to /restablecer", async () => {
    const member = await createUser("agent");
    await requestPasswordResetAction({ email: member.email.toUpperCase() });
    await requestPasswordResetAction({ email: "tampoco-existe@example.com" });
    const [queued] = await resetEmailsTo(member.email);
    expect(queued).toBeDefined();
    const url = new URL((queued.payload as { url: string }).url);
    expect(url.pathname).toMatch(/^\/api\/auth\/reset-password\/[A-Za-z0-9]+$/);
    expect(url.searchParams.get("callbackURL")).toBe("/restablecer");
    expect(await resetEmailsTo("tampoco-existe@example.com")).toHaveLength(0);
  });
});

describe("requests are rate limited [SEG-07]", () => {
  it("3 links per email and hour, even from different IPs", async () => {
    const member = await createUser("viewer");
    for (let attempt = 0; attempt < 3; attempt++) {
      request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
      expect((await requestPasswordResetAction({ email: member.email })).ok).toBe(true);
    }
    request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
    expect(await requestPasswordResetAction({ email: member.email })).toEqual({ ok: false, error: TOO_MANY_ATTEMPTS_MESSAGE });
    expect(await resetEmailsTo(member.email)).toHaveLength(3);
  });

  it("5 requests per IP in 15 minutes, whatever the email", async () => {
    request.headers = new Headers({ "x-forwarded-for": "192.0.2.44" });
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await requestPasswordResetAction({ email: `persona-${attempt}@example.com` })).ok).toBe(true);
    }
    expect(await requestPasswordResetAction({ email: "otra@example.com" })).toEqual({ ok: false, error: TOO_MANY_ATTEMPTS_MESSAGE });
  });
});

describe("invalid input is refused [SEG-05]", () => {
  it.each([["bad email", { email: "no-es-un-email" }], ["nothing", null], ["empty", {}]])("%s", async (_label, input) => {
    const result = await requestPasswordResetAction(input);
    expect(result.ok).toBe(false);
  });
});
