// What /ajustes/correo sends to the browser: the SMTP settings and the password only as «••••1234» ([SEG-02]).
import "server-only";
import { getIntegrationSettings, type SecretView } from "@/data/settings";
import type { SmtpSettings } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { isOutboxAllowed } from "@/server/mailer";

export type MailSettingsView = {
  smtp: SmtpSettings | null;
  password: SecretView;
  /** Without SMTP, mail is kept in the local outbox (development and demo) instead of failing. */
  outboxAllowed: boolean;
};

export async function loadMailSettingsView(actor: Actor): Promise<MailSettingsView> {
  const settings = await getIntegrationSettings(actor);
  const smtp = settings.smtp;
  return {
    smtp: smtp
      ? {
          host: smtp.host,
          port: smtp.port,
          security: smtp.security,
          user: smtp.user,
          fromEmail: smtp.fromEmail,
          fromName: smtp.fromName,
        }
      : null,
    password: settings.smtpPassword,
    outboxAllowed: isOutboxAllowed(),
  };
}
