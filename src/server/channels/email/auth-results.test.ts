// [COR-25] Whether the server that received an email vouched for its sender: only the top Authentication-Results header
// (RFC 8601), the one the receiving server adds; DMARC decides, and without a DMARC result, SPF or DKIM aligned with the
// From domain. Anything else — no header, a failure, a header a sender wrote further down — is «no verificado».
import { describe, expect, it } from "vitest";
import { parseAuthenticationResults, senderVerification } from "./auth-results";

const FROM = "ana@cliente.test";
const verify = (values: string[], from: string | null = FROM, fromCount = 1) => senderVerification({ "authentication-results": values }, from, fromCount);

describe("reading an Authentication-Results header (RFC 8601) [COR-25]", () => {
  it("Gmail's: the server's id, then each method with its result and properties; comments are ignored", () => {
    const parsed = parseAuthenticationResults(
      "mx.google.com; dkim=pass header.i=@cliente.test header.s=s1 header.b=AbC; spf=pass (google.com: domain of ana@cliente.test designates 192.0.2.1 as permitted sender) smtp.mailfrom=ana@cliente.test; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=cliente.test",
    );
    expect(parsed.authservId).toBe("mx.google.com");
    expect(parsed.results).toEqual([
      { method: "dkim", result: "pass", props: { "header.i": "@cliente.test", "header.s": "s1", "header.b": "AbC" } },
      { method: "spf", result: "pass", props: { "smtp.mailfrom": "ana@cliente.test" } },
      { method: "dmarc", result: "pass", props: { "header.from": "cliente.test" } },
    ]);
  });

  it("Microsoft's has no server id; a «;» inside a comment or quotes does not split it", () => {
    const parsed = parseAuthenticationResults(
      'spf=pass (sender IP is 192.0.2.1; checked) smtp.mailfrom=cliente.test; dkim=pass (signature was verified) header.d=cliente.test;dmarc=pass action=none header.from=cliente.test;compauth=pass reason="100; ok"',
    );
    expect(parsed.authservId).toBeNull();
    expect(parsed.results.map((result) => `${result.method}=${result.result}`)).toEqual(["spf=pass", "dkim=pass", "dmarc=pass", "compauth=pass"]);
    expect(parsed.results[2].props).toEqual({ action: "none", "header.from": "cliente.test" });
  });

  it("«none» and nonsense give no results, and never throw", () => {
    expect(parseAuthenticationResults("mx.example.test; none").results).toEqual([]);
    expect(parseAuthenticationResults("").results).toEqual([]);
    expect(parseAuthenticationResults("((((; = ; ==").results).toEqual([]);
    expect(parseAuthenticationResults(`x; ${"dkim=pass ".repeat(2_000)}`).results.length).toBeLessThanOrEqual(50);
  });
});

describe("the sender is verified only when the receiving server says so [COR-25]", () => {
  it("DMARC passed for the From domain", () => {
    expect(verify(["mx.google.com; dkim=pass header.i=@cliente.test; spf=pass smtp.mailfrom=ana@cliente.test; dmarc=pass (p=REJECT) header.from=cliente.test"])).toEqual({ verified: true, method: "dmarc" });
    expect(verify(["spf=pass (sender IP is 192.0.2.1) smtp.mailfrom=cliente.test; dkim=pass header.d=cliente.test;dmarc=pass action=none header.from=cliente.test"])).toEqual({ verified: true, method: "dmarc" });
  });

  it("a DMARC failure is final, even with SPF or DKIM passing for another domain", () => {
    expect(verify(["mx.google.com; dkim=pass header.i=@atacante.test; spf=pass smtp.mailfrom=x@atacante.test; dmarc=fail (p=NONE) header.from=cliente.test"])).toMatchObject({ verified: false });
    expect(verify(["mx.google.com; dmarc=temperror header.from=cliente.test"])).toMatchObject({ verified: false });
  });

  it("DMARC passed, but for another domain than the From it came with", () => {
    expect(verify(["mx.google.com; dmarc=pass header.from=atacante.test"])).toMatchObject({ verified: false });
  });

  it("without a DMARC result (or «none»: the domain has no policy), SPF or DKIM passing and aligned with the From domain", () => {
    expect(verify(["mx.example.test; dkim=pass header.d=cliente.test"])).toEqual({ verified: true, method: "dkim" });
    expect(verify(["mx.example.test; dkim=pass header.i=@mail.cliente.test"], "ana@cliente.test")).toEqual({ verified: true, method: "dkim" });
    expect(verify(["mx.example.test; spf=pass smtp.mailfrom=rebotes@cliente.test"], "ana@ventas.cliente.test")).toEqual({ verified: true, method: "spf" });
    expect(verify(["spf=pass smtp.mailfrom=cliente.test; dkim=none; dmarc=none action=none header.from=cliente.test"])).toEqual({ verified: true, method: "spf" });
  });

  it("…but not when they pass for someone else's domain, nor for a whole top-level domain", () => {
    expect(verify(["mx.example.test; dkim=pass header.d=atacante.test; spf=pass smtp.mailfrom=x@atacante.test"])).toMatchObject({ verified: false });
    expect(verify(["mx.example.test; dkim=pass header.d=test"])).toMatchObject({ verified: false });
    expect(verify(["mx.example.test; dkim=pass header.d=otrocliente.test"])).toMatchObject({ verified: false });
    expect(verify(["mx.example.test; spf=softfail smtp.mailfrom=ana@cliente.test; dkim=neutral header.d=cliente.test"])).toMatchObject({ verified: false });
  });

  it("only the top header counts: one the sender wrote below the server's own is ignored", () => {
    const server = "mx.google.com; spf=fail smtp.mailfrom=x@atacante.test; dmarc=fail header.from=cliente.test";
    const forged = "mx.google.com; dkim=pass header.i=@cliente.test; dmarc=pass header.from=cliente.test";
    expect(verify([server, forged])).toMatchObject({ verified: false });
    expect(verify([forged, server])).toEqual({ verified: true, method: "dmarc" });
  });

  it("no header, no From, or more than one From is never verified", () => {
    expect(verify([])).toMatchObject({ verified: false });
    expect(senderVerification({}, FROM, 1)).toMatchObject({ verified: false });
    expect(verify(["mx.google.com; dmarc=pass header.from=cliente.test"], null)).toMatchObject({ verified: false });
    expect(verify(["mx.google.com; dmarc=pass header.from=cliente.test"], FROM, 2)).toMatchObject({ verified: false });
  });

  it("case and spaces do not matter", () => {
    expect(verify(["MX.GOOGLE.COM ;  DMARC = Pass  header.from = Cliente.Test"])).toEqual({ verified: true, method: "dmarc" });
  });
});
