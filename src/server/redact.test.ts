import { DrizzleQueryError, sql } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { REDACTED, redactSecrets, safeErrorMessage, stripSecrets } from "./redact";

/** A postgres.js error as the driver builds it from the server's ErrorResponse, with the query it attaches. */
function postgresJsError(fields: Record<string, string>, query: string, parameters: unknown[]): Error {
  const PostgresError = postgres.PostgresError as unknown as new (fields: Record<string, string>) => Error;
  const error = new PostgresError({ severity_local: "ERROR", severity: "ERROR", file: "nbtinsert.c", line: "666", routine: "_bt_check_unique", ...fields });
  return Object.defineProperties(error, { query: { value: query }, parameters: { value: parameters } });
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("The query should have failed.");
}

// Fake tokens are put together at runtime: no literal in the repository may look like a real key to secret scanners
// (GitHub flagged the Telegram documentation example that used to be written here).
const fakeTokenBody = (length: number) => "FALSOPRUEBA0".repeat(Math.ceil(length / 12)).slice(0, length);

describe("redact [SEG-02] [SEG-14]", () => {
  it("redacts token-looking substrings", () => {
    const telegramToken = ["bot123456", fakeTokenBody(35)].join(":");
    const text =
      "Authorization: Bearer abc.def-123 key sk-or-v1-0123456789abcdef meta EAAB1234567890abcdefghijkl " +
      `url https://api.telegram.org/${telegramToken}/getMe ?token=xyz&x=1`;
    const result = redactSecrets(text);
    expect(result).not.toMatch(/abc\.def-123|0123456789abcdef|EAAB1234567890|FALSOPRUEBA0|xyz/);
    expect(result).toContain("x=1");
  });

  it("redacts Supabase keys and the credentials of Postgres connection strings", () => {
    const secretKey = ["sb", "secret", fakeTokenBody(32)].join("_");
    const publishableKey = ["sb", "publishable", fakeTokenBody(32)].join("_");
    expect(redactSecrets(`SUPABASE_SECRET_KEY=${secretKey} apikey: ${publishableKey}`)).toBe(
      `SUPABASE_SECRET_KEY=sb_secret_${REDACTED} apikey: sb_publishable_${REDACTED}`,
    );

    const password = ["Sup3r", "Secreta_2026"].join("-");
    const pooler = `postgresql://postgres.abcdefghijklmnop:${password}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`;
    expect(redactSecrets(`No conecta con ${pooler}`)).toBe(`No conecta con postgresql://${REDACTED}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`);
    // A password typed raw, with «@» and «/», is not left half visible; postgres:// too.
    const raw = redactSecrets('DATABASE_URL="postgres://app:p@ss/w0rd@db.example.com:5432/app"');
    expect(raw).toBe(`DATABASE_URL="postgres://${REDACTED}@db.example.com:5432/app"`);
    expect(raw).not.toMatch(/ss\/w0rd|app:p/);
  });

  it("strips secret-named fields deeply and keeps the rest", () => {
    const result = stripSecrets({
      email: "ana@example.com",
      smtpPassword: "hunter2",
      nested: { accessToken: "t", secretsEnc: "v1:…", list: [{ apiKey: "k", name: "ok" }] },
    });
    expect(result).toEqual({
      email: "ana@example.com",
      smtpPassword: REDACTED,
      nested: { accessToken: REDACTED, secretsEnc: REDACTED, list: [{ apiKey: REDACTED, name: "ok" }] },
    });
  });

  it("safeErrorMessage never returns secrets and handles non-errors", () => {
    expect(safeErrorMessage(new Error("fallo con Bearer abcdef"))).toBe(`fallo con Bearer ${REDACTED}`);
    expect(safeErrorMessage(42)).toBe("Error desconocido");
    expect(safeErrorMessage("x".repeat(600))).toHaveLength(501);
  });

  it("a failed database query never shows its parameters (phones, identifiers, texts): only the database's code [SEG-14]", () => {
    const params = ["34600111222", "ES.20000000000000000002", "Hola, soy Ana y mi teléfono es el 600 111 222"];
    const query = 'insert into "messages" ("external_id", "phone", "text") values ($1, $2, $3)';
    const busy = new DrizzleQueryError(query, params, postgresJsError({ code: "55P03", message: "canceling statement due to lock timeout" }, query, params));
    const constraint = new DrizzleQueryError(
      query,
      params,
      postgresJsError(
        {
          code: "23505",
          message: 'duplicate key value violates unique constraint "messages_external_id_unique"',
          detail: "Key (external_id)=(ES.20000000000000000002) already exists.",
          schema_name: "public",
          table_name: "messages",
          constraint_name: "messages_external_id_unique",
        },
        query,
        params,
      ),
    );
    for (const [error, code] of [[busy, "55P03"], [constraint, "23505, messages_external_id_unique"]] as const) {
      const message = safeErrorMessage(error);
      for (const value of params) expect(message).not.toContain(value);
      expect(message).not.toContain("insert into");
      expect(message).toBe(`Error de la base de datos (${code}).`);
    }
    // Also when another message wraps it, or without a known cause.
    const wrapped = safeErrorMessage(new Error(`No se pudo guardar: ${busy.message}`));
    expect(wrapped).toBe("No se pudo guardar: Error de la base de datos.");
    expect(safeErrorMessage(new DrizzleQueryError(query, params))).toBe("Error de la base de datos.");
  });

  it("of a Postgres error only the SQLSTATE and the constraint are kept, never its message, detail or where [SEG-14]", async () => {
    // PGlite, through Drizzle: the detail repeats the key, the email included.
    const key = "login:email:ana.garcia@example.com";
    await db.insert(rateLimits).values({ key, count: 1, windowStart: new Date() });
    const duplicate = await failure(() => db.insert(rateLimits).values({ key, count: 1, windowStart: new Date() }));
    expect(duplicate).toBeInstanceOf(DrizzleQueryError);
    const cause = (duplicate as DrizzleQueryError).cause;
    expect(cause).toMatchObject({ code: "23505", constraint: "rate_limits_key_unique", detail: expect.stringContaining(key) });
    expect(safeErrorMessage(duplicate)).toBe("Error de la base de datos (23505, rate_limits_key_unique).");
    // The same error without Drizzle's wrapper (as a failed COMMIT throws it).
    expect(safeErrorMessage(cause)).toBe("Error de la base de datos (23505, rate_limits_key_unique).");

    // A message that quotes the value itself.
    const badNumber = await failure(() => db.execute(sql`SELECT ${"600111222x"}::integer`));
    expect((badNumber as DrizzleQueryError).cause).toMatchObject({ code: "22P02", message: expect.stringContaining("600111222x") });
    expect(safeErrorMessage(badNumber)).toBe("Error de la base de datos (22P02).");

    // postgres.js (Supabase), bare: the failing row in `detail`, the calling statement in `where`.
    const checkFailed = postgresJsError(
      {
        code: "23514",
        message: 'new row for relation "business_settings" violates check constraint "business_settings_singleton_ck"',
        detail: "Failing row contains (2, Peluquería Ana, ana.garcia@example.com, 600111222).",
        where: `SQL statement "insert into business_settings values (2, 'Peluquería Ana')"`,
        schema_name: "public",
        table_name: "business_settings",
        constraint_name: "business_settings_singleton_ck",
      },
      'insert into "business_settings" ("singleton", "name") values ($1, $2)',
      [2, "Peluquería Ana"],
    );
    const message = safeErrorMessage(checkFailed);
    expect(message).toBe("Error de la base de datos (23514, business_settings_singleton_ck).");
    for (const value of ["Peluquería", "ana.garcia", "600111222", "Failing row", "insert into"]) expect(message).not.toContain(value);
  });
});
