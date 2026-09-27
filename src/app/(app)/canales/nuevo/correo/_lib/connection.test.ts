// What the wizard says after the return from Google or Microsoft ([COR-03], [COR-07], [COR-23]): the Spanish reason of
// the `motivo` (never the provider's own text) and, once connected, which of the required permissions were granted.
import { describe, expect, it } from "vitest";
import { OAUTH_FAILURE_MESSAGES } from "@/server/channels/email/oauth-results";
import { grantedPermissions, readConnectionOutcome } from "./connection";

describe("return from Google or Microsoft [COR-23]", () => {
  it("«conexion=ok» is a connected mailbox", () => {
    expect(readConnectionOutcome({ canal: "x", conexion: "ok" })).toEqual({ kind: "connected" });
  });

  it("an error shows the Spanish text of its code", () => {
    expect(readConnectionOutcome({ conexion: "error", motivo: "missing_scopes" })).toEqual({
      kind: "failed",
      reason: "missing_scopes",
      message: OAUTH_FAILURE_MESSAGES.missing_scopes,
    });
    expect(readConnectionOutcome({ conexion: "error", motivo: "admin_consent_required" })).toMatchObject({ kind: "failed", reason: "admin_consent_required" });
  });

  it("an unknown or repeated `motivo` never reaches the screen: a generic text instead", () => {
    const unknown = readConnectionOutcome({ conexion: "error", motivo: "<script>AADSTS50011 redirect mismatch</script>" });
    expect(unknown).toMatchObject({ kind: "failed", reason: null });
    expect(unknown && "message" in unknown ? unknown.message : "").not.toContain("AADSTS");
    expect(readConnectionOutcome({ conexion: "error", motivo: ["denied", "denied"] })).toMatchObject({ kind: "failed", reason: null });
  });

  it("the administrator's consent came back from Microsoft", () => {
    expect(readConnectionOutcome({ consentimiento: "ok" })).toEqual({ kind: "admin_consent" });
  });

  it("nothing in the address, nothing to say", () => {
    expect(readConnectionOutcome({})).toBeNull();
    expect(readConnectionOutcome({ conexion: "quizá" })).toBeNull();
  });
});

describe("permissions granted [COR-03] [COR-07]", () => {
  it("Gmail: reading and changing the mail and the account's address, each checked", () => {
    const all = grantedPermissions("email_gmail", ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/gmail.modify"]);
    expect(all.map((check) => [check.key, check.granted])).toEqual([
      ["gmail.modify", true],
      ["email", true],
      ["openid", true],
    ]);
    const withoutMail = grantedPermissions("email_gmail", ["openid", "email"]);
    expect(withoutMail.find((check) => check.key === "gmail.modify")?.granted).toBe(false);
    expect(withoutMail.find((check) => check.key === "email")?.granted).toBe(true);
  });

  it("Outlook: Mail.ReadWrite, Mail.Send and User.Read, with or without the Graph prefix", () => {
    const checks = grantedPermissions("email_outlook", ["https://graph.microsoft.com/Mail.ReadWrite", "User.Read"]);
    expect(checks.map((check) => [check.key, check.granted])).toEqual([
      ["Mail.ReadWrite", true],
      ["Mail.Send", false],
      ["User.Read", true],
    ]);
  });

  it("IMAP/SMTP has no permissions to grant", () => {
    expect(grantedPermissions("email_imap", [])).toEqual([]);
  });
});
