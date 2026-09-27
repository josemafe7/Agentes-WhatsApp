import { LibsqlError } from "@libsql/client";
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets, safeErrorMessage, stripSecrets } from "./redact";

describe("redact [SEG-02] [SEG-14]", () => {
  it("redacts token-looking substrings", () => {
    const text =
      "Authorization: Bearer abc.def-123 key sk-or-v1-0123456789abcdef meta EAAB1234567890abcdefghijkl " +
      "url https://api.telegram.org/bot123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/getMe ?token=xyz&x=1";
    const result = redactSecrets(text);
    expect(result).not.toMatch(/abc\.def-123|0123456789abcdef|EAAB1234567890|AAHdqTcv|xyz/);
    expect(result).toContain("x=1");
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
    const query = 'insert into "messages" ("external_id", "phone", "text") values (?, ?, ?)';
    const busy = new DrizzleQueryError(query, params, new LibsqlError("database is locked", "SQLITE_BUSY", "SQLITE_BUSY", 5));
    const constraint = new DrizzleQueryError(query, params, new LibsqlError("UNIQUE constraint failed", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_UNIQUE", 2067));
    for (const [error, code] of [[busy, "SQLITE_BUSY"], [constraint, "SQLITE_CONSTRAINT_UNIQUE"]] as const) {
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
});
