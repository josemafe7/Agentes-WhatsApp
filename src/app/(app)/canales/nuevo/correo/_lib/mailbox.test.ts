// What «Conectar» gets of a mailbox being resumed or reconnected ([COR-07], [COR-22], [SEG-02], [PER-07]): the saved
// Client IDs, tenant, expiry and servers to fill the forms in again, and the secrets only masked.
import { describe, expect, it } from "vitest";
import type { EmailChannelView } from "@/data/email";
import { dateInputValue, wizardMailbox } from "./mailbox";

function view(overrides: Partial<EmailChannelView>): EmailChannelView {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    type: "email_outlook",
    name: "Outlook",
    status: "error",
    isDemo: false,
    emailAddress: "hola@negocio.test",
    reconnect: { reason: "Microsoft ya no acepta el acceso", at: "2026-09-27T00:00:00Z", label: "Requiere reconexión" },
    lastSyncAt: null,
    health: null,
    grantedScopes: [],
    settings: { signature: null, dailyCapPerThread: 5, dailyCapPerSender: 10, imapIdle: false },
    ignored: [],
    gmail: null,
    outlook: null,
    imap: null,
    ...overrides,
  };
}

describe("a mailbox resumed in the wizard", () => {
  it("Outlook: Client ID, tenant, the expiry as the date input wants it and the secret masked; why it needs reconnecting", () => {
    const mailbox = wizardMailbox(
      view({
        outlook: {
          clientId: "c",
          tenant: "common",
          clientSecretExpiresAt: "2027-06-01T00:00:00.000Z",
          secretExpiry: null,
          redirectUri: "http://localhost:3000/api/oauth/microsoft/callback",
          clientSecret: "••••1234",
          adminConsentAvailable: false,
        },
      }),
    );
    expect(mailbox.outlook).toEqual({ clientId: "c", tenant: "common", secretExpiresOn: "2027-06-01", maskedSecret: "••••1234" });
    expect(mailbox.reconnectReason).toBe("Microsoft ya no acepta el acceso");
    expect(mailbox.gmail).toBeNull();
    expect(mailbox.imap).toBeNull();
  });

  it("IMAP: the servers and users again, the password masked, and only the two security modes", () => {
    const mailbox = wizardMailbox(
      view({
        type: "email_imap",
        reconnect: null,
        imap: {
          imapHost: "imap.hosting.test",
          imapPort: 993,
          imapSecurity: "tls",
          smtpHost: "smtp.hosting.test",
          smtpPort: 587,
          smtpSecurity: "starttls",
          username: null,
          smtpUsername: "envios@negocio.test",
          sentPath: "Enviados",
          draftsPath: "Borradores",
          password: "••••ñora",
        },
      }),
    );
    expect(mailbox.imap).toEqual({
      username: null,
      smtpUsername: "envios@negocio.test",
      imapHost: "imap.hosting.test",
      imapPort: 993,
      imapSecurity: "tls",
      smtpHost: "smtp.hosting.test",
      smtpPort: 587,
      smtpSecurity: "starttls",
      maskedPassword: "••••ñora",
    });
    expect(mailbox.reconnectReason).toBeNull();
  });

  it("[PER-07] without masked secrets (another role) the forms get none", () => {
    const mailbox = wizardMailbox(view({ type: "email_gmail", gmail: { clientId: "1.apps.googleusercontent.com", redirectUri: "x", clientSecret: null } }));
    expect(mailbox.gmail).toEqual({ clientId: "1.apps.googleusercontent.com", maskedSecret: null });
  });

  it("reads only well-formed dates", () => {
    expect(dateInputValue("2027-06-01T00:00:00.000Z")).toBe("2027-06-01");
    expect(dateInputValue("mañana")).toBeNull();
    expect(dateInputValue(null)).toBeNull();
  });
});
