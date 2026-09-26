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
});
