// Better Auth with our schema and our user creation (src/server/accounts.ts), through the server API that the
// Server Actions use and through its real HTTP handler (/api/auth/*).
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The reset email goes out through the system mail: faked here, so nothing is written to data/outbox.
const mail = vi.hoisted(() => ({
  sent: [] as { kind: string; to: string; text?: string; html?: string }[],
  result: { ok: true, via: "outbox", file: "x.eml", logId: "log" } as
    | { ok: true; via: "outbox"; file: string; logId: string }
    | { ok: false; reason: "not_configured" | "send_failed"; message: string; logId: string },
}));
vi.mock("./mailer", () => ({
  sendSystemEmail: async (email: { kind: string; to: string; text?: string; html?: string }) => {
    mail.sent.push(email);
    return mail.result;
  },
}));

import { db } from "@/db";
import { jobs, session, user, verification } from "@/db/schema";
import { createBusiness, createUser, TEST_PASSWORD } from "@/test/factories";
import { ConflictError, ValidationError } from "./errors";
import { createFirstOwner, createUserWithPassword, EmailInUseError } from "./accounts";
import { auth } from "./auth";
import { SYSTEM_EMAIL_JOB } from "./jobs/handlers/system-email";
import { tick } from "./jobs/tick";

const ORIGIN = "http://localhost:3000";
let ipCounter = 0;
const nextIp = () => `10.0.0.${++ipCounter}`;

/** A request to /api/auth/<path> from a fresh client IP (each test gets its own rate-limit bucket). */
function http(method: string, path: string, init: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": nextIp() };
  if (init.cookie) headers.cookie = init.cookie;
  if (method !== "GET") headers["content-type"] = "application/json";
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method,
      headers,
      ...(method !== "GET" ? { body: JSON.stringify(init.body ?? {}) } : {}),
    }),
  );
}

/** Signs in as the Server Actions do (auth.api.*, never over HTTP) and returns the response. */
function serverSignIn(email: string, password: string) {
  return auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ "x-forwarded-for": nextIp() }),
    asResponse: true,
  });
}

function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

beforeAll(async () => {
  await createBusiness();
});

describe("sign-in with accounts created by the app [USU-01]", () => {
  it("a user created server-side signs in with email and password, whatever the email case", async () => {
    const member = await createUser("supervisor");
    const response = await serverSignIn(member.email.toUpperCase(), TEST_PASSWORD);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("dominia.session_token=");
    const body = (await response.json()) as { user: { id: string } };
    expect(body.user.id).toBe(member.userId);
  });

  it("a wrong password or unknown email get the same 401", async () => {
    const member = await createUser("agent");
    const wrong = await serverSignIn(member.email, "no-es-esta-123");
    const unknown = await serverSignIn("nadie@example.com", TEST_PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });
});

describe("closed sign-up [USU-03]", () => {
  it("the sign-up endpoint does not exist and the server API refuses too", async () => {
    const response = await http("POST", "/sign-up/email", { body: { email: "intruso@example.com", password: TEST_PASSWORD, name: "X" } });
    expect(response.status).toBe(404);
    await expect(
      auth.api.signUpEmail({ body: { email: "intruso2@example.com", password: TEST_PASSWORD, name: "X" } }),
    ).rejects.toThrow();
    expect(await db.select().from(user).where(eq(user.email, "intruso@example.com"))).toHaveLength(0);
  });
});

// Signing in, the two-step code, password reset and «Mi cuenta» go through Server Actions, which add the limits
// per email and per user, the activity log and our own validation. Over HTTP they would skip all of that, so
// Better Auth answers only what the app itself needs from the browser ([USU-13] [SEG-05] [SEG-07] [SEG-10]).
describe("only the endpoints the app needs answer over HTTP [SEG-07] [SEG-10] [USU-13] [SEG-05]", () => {
  it("direct sign-in over HTTP does not exist: a burst of attempts gets 404 and opens no session", async () => {
    const member = await createUser("viewer");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await http("POST", "/sign-in/email", { body: { email: member.email, password: TEST_PASSWORD } })).status);
    expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);
    expect(await db.select().from(session).where(eq(session.userId, member.userId))).toHaveLength(0);
  });

  it.each([
    "/sign-in/email",
    "/request-password-reset",
    "/reset-password",
    "/change-password",
    "/update-user",
    "/revoke-other-sessions",
    "/two-factor/enable",
    "/two-factor/disable",
    "/two-factor/verify-totp",
    "/two-factor/verify-backup-code",
    "/two-factor/get-totp-uri",
    "/two-factor/generate-backup-codes",
  ])("POST %s answers 404, even with a valid session", async (path) => {
    const member = await createUser("admin");
    const cookie = cookieOf(await serverSignIn(member.email, TEST_PASSWORD));
    const response = await http("POST", path, { cookie, body: { email: member.email, password: TEST_PASSWORD, name: "x".repeat(10) } });
    expect(response.status).toBe(404);
  });

  it("a name sent straight to /update-user changes nothing", async () => {
    const member = await createUser("agent", { name: "Nombre de verdad" });
    const cookie = cookieOf(await serverSignIn(member.email, TEST_PASSWORD));
    const response = await http("POST", "/update-user", { cookie, body: { name: "x".repeat(10_000) } });
    expect(response.status).toBe(404);
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, member.userId));
    expect(row.name).toBe("Nombre de verdad");
  });

  it("every other Better Auth endpoint, present or future, answers 404 over HTTP", async () => {
    const allowed = new Set(["GET /get-session", "POST /sign-out", "GET /reset-password/:token"]);
    const endpoints = Object.values(auth.api) as unknown as { path?: string; options?: { method?: string | string[] } }[];
    const checked: string[] = [];
    for (const endpoint of endpoints) {
      if (!endpoint.path?.startsWith("/")) continue;
      const methods = [endpoint.options?.method ?? "GET"].flat().filter((method) => method !== "*");
      for (const method of methods.length > 0 ? methods : ["GET", "POST"]) {
        if (allowed.has(`${method} ${endpoint.path}`)) continue;
        const response = await http(method, endpoint.path.replace(/:[^/]+/g, "x"));
        expect(response.status, `${method} ${endpoint.path}`).toBe(404);
        checked.push(`${method} ${endpoint.path}`);
      }
    }
    expect(checked.length).toBeGreaterThan(20);
  });

  it("what stays open: the session check, signing out and the link of the password reset email", async () => {
    const member = await createUser("supervisor");
    const cookie = cookieOf(await serverSignIn(member.email, TEST_PASSWORD));

    const current = await http("GET", "/get-session", { cookie });
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ user: { id: member.userId } });

    const link = await http("GET", `/reset-password/token-inventado?callbackURL=${encodeURIComponent("/restablecer")}`);
    expect(link.status).toBe(302);
    expect(link.headers.get("location")).toContain("/restablecer");

    const signOut = await http("POST", "/sign-out", { cookie });
    expect(signOut.status).toBe(200);
    expect(await (await http("GET", "/get-session", { cookie })).json()).toBeNull();
  });
});

describe("password reset request [USU-10]", () => {
  it("answers the same whether the email exists or not, and queues the email only for real accounts", async () => {
    const member = await createUser("agent");
    const request = (email: string) =>
      auth.api.requestPasswordReset({
        body: { email, redirectTo: "/restablecer" },
        headers: new Headers({ "x-forwarded-for": nextIp() }),
        asResponse: true,
      });
    const existing = await request(member.email);
    const missing = await request("no-existe@example.com");
    expect(existing.status).toBe(200);
    expect(missing.status).toBe(200);
    expect(await existing.json()).toEqual(await missing.json());
    const queued = (await db.select().from(jobs).where(eq(jobs.type, SYSTEM_EMAIL_JOB))).filter((job) =>
      [member.email, "no-existe@example.com"].includes((job.payload as { to: string }).to),
    );
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ template: "password_reset", to: member.email });
    expect((queued[0].payload as { url: string }).url).toContain("/api/auth/reset-password/");
  });
});

describe("a copy of the database gives no working reset link [USU-10] [SEG-02]", () => {
  /** Asks for a reset link and returns its job and the token inside the queued link. */
  async function requestReset(email: string) {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/restablecer" }, headers: new Headers({ "x-forwarded-for": nextIp() }) });
    const [job] = (await db.select().from(jobs).where(eq(jobs.type, SYSTEM_EMAIL_JOB))).filter(
      (row) => (row.payload as { to: string }).to === email && row.status === "pending",
    );
    const token = new URL((job.payload as { url: string }).url).pathname.split("/").at(-1) ?? "";
    return { job, token };
  }

  const jobById = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];

  beforeEach(() => {
    mail.sent.length = 0;
    mail.result = { ok: true, via: "outbox", file: "x.eml", logId: "log" };
  });

  it("the token is stored only as its SHA-256, and the link still works", async () => {
    const member = await createUser("agent");
    const { token } = await requestReset(member.email);
    expect(token.length).toBeGreaterThan(20);
    const stored = await db.select({ identifier: verification.identifier }).from(verification);
    expect(stored.some((row) => row.identifier.includes(token))).toBe(false);
    const hashed = createHash("sha256").update(`reset-password:${token}`).digest("base64url");
    expect(stored.map((row) => row.identifier)).toContain(hashed);

    await auth.api.resetPassword({ body: { token, newPassword: "otra-clave-segura-9" } });
    expect((await serverSignIn(member.email, "otra-clave-segura-9")).status).toBe(200);
  });

  it("once the email is sent, its job keeps no link", async () => {
    const member = await createUser("supervisor");
    const { job, token } = await requestReset(member.email);
    await tick({ budgetMs: 20_000 });
    const finished = await jobById(job.id);
    expect(finished.status).toBe("done");
    expect(mail.sent.filter((email) => email.to === member.email)).toHaveLength(1);
    expect(finished.payload).toMatchObject({ template: "password_reset", to: member.email, url: null });
    expect(JSON.stringify(finished.payload)).not.toContain(token);
    // Running it again sends nothing twice.
    await db.update(jobs).set({ status: "pending", runAt: new Date(), finishedAt: null }).where(eq(jobs.id, job.id));
    await tick({ budgetMs: 20_000 });
    expect(mail.sent.filter((email) => email.to === member.email)).toHaveLength(1);
  });

  it("nor when the email cannot be sent: a failed job keeps no link either", async () => {
    mail.result = { ok: false, reason: "not_configured", message: "Configura el correo del sistema.", logId: "log" };
    const member = await createUser("viewer");
    const { job, token } = await requestReset(member.email);
    await tick({ budgetMs: 20_000 });
    const finished = await jobById(job.id);
    expect(finished.status).toBe("failed");
    expect(JSON.stringify(finished.payload)).not.toContain(token);
  });
});

describe("createUserWithPassword and createFirstOwner [ASI-02]", () => {
  it("normalises the email and refuses duplicates and weak passwords", async () => {
    const created = await createUserWithPassword({ name: "Eva", email: "  EVA@Example.com ", password: TEST_PASSWORD, role: "admin" });
    expect(created.email).toBe("eva@example.com");
    await expect(
      createUserWithPassword({ name: "Eva 2", email: "eva@example.com", password: TEST_PASSWORD, role: "admin" }),
    ).rejects.toBeInstanceOf(EmailInUseError);
    await expect(
      createUserWithPassword({ name: "Corta", email: "corta@example.com", password: "123", role: "viewer" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("createFirstOwner only while there are no users [ASI-02]", () => {
  it("fails once any user exists", async () => {
    await expect(createFirstOwner({ name: "Otro", email: "otro-owner@example.com", password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
