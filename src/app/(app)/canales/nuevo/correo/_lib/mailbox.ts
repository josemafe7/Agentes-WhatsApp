// What the «Conectar» step of an existing mailbox needs from the channel view (src/data/email.ts): the stored Client
// IDs, tenant, expiry and servers to fill the forms in again, and the secrets only masked («••••1234», [SEG-02],
// [PER-07]) so SecretField can offer «Cambiar». Pure.
import type { EmailChannelView } from "@/data/email";
import type { EmailChannelType } from "@/server/channels/email/config";

export type MailSecurityOption = "tls" | "starttls";

export type WizardMailbox = {
  id: string;
  type: EmailChannelType;
  name: string;
  emailAddress: string | null;
  /** «Requiere reconexión» and why ([COR-22]). */
  reconnectReason: string | null;
  gmail: { clientId: string | null; maskedSecret: string | null } | null;
  outlook: { clientId: string | null; tenant: string | null; secretExpiresOn: string | null; maskedSecret: string | null } | null;
  imap: {
    username: string | null;
    smtpUsername: string | null;
    imapHost: string | null;
    imapPort: number | null;
    imapSecurity: MailSecurityOption | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecurity: MailSecurityOption | null;
    maskedPassword: string | null;
  } | null;
};

const securityOf = (value: string | null): MailSecurityOption | null => (value === "tls" || value === "starttls" ? value : null);

/** The date input's value (AAAA-MM-DD) of a stored ISO date. */
export function dateInputValue(iso: string | null): string | null {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

export function wizardMailbox(view: EmailChannelView): WizardMailbox {
  return {
    id: view.id,
    type: view.type,
    name: view.name,
    emailAddress: view.emailAddress,
    reconnectReason: view.reconnect?.reason ?? null,
    gmail: view.gmail ? { clientId: view.gmail.clientId, maskedSecret: view.gmail.clientSecret } : null,
    outlook: view.outlook
      ? { clientId: view.outlook.clientId, tenant: view.outlook.tenant, secretExpiresOn: dateInputValue(view.outlook.clientSecretExpiresAt), maskedSecret: view.outlook.clientSecret }
      : null,
    imap: view.imap
      ? {
          username: view.imap.username,
          smtpUsername: view.imap.smtpUsername,
          imapHost: view.imap.imapHost,
          imapPort: view.imap.imapPort,
          imapSecurity: securityOf(view.imap.imapSecurity),
          smtpHost: view.imap.smtpHost,
          smtpPort: view.imap.smtpPort,
          smtpSecurity: securityOf(view.imap.smtpSecurity),
          maskedPassword: view.imap.password,
        }
      : null,
  };
}
