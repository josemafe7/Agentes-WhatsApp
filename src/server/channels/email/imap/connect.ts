// «Probar conexión» and connecting an «Otro (IMAP/SMTP)» mailbox ([COR-09]–[COR-11]): IMAP login and folder list,
// then SMTP verify, each failure explained in Spanish; nothing is stored unless both work. Microsoft mailboxes are
// sent to the Outlook option. A stored password only goes back to the same servers, ports, security and users
// (docs/security.md «Un secreto guardado solo vuelve a donde se guardó»).
import "server-only";
import { z } from "zod";
import { emailSchema } from "@/lib/validation";
import type { ChannelRecord, ConnectResult } from "../../types";
import { MAIL_SECURITY, readEmailConfig, readMailPasswords, type EmailConfigPatch, type MailPasswords } from "../config";
import { BLOCKED_PORTS, closeImap, openImap, openSmtp, type MailConnectors, type MailServerSettings } from "./connection";
import { describeMailError } from "./errors";
import { domainOf, isMicrosoftMailHost, MICROSOFT_DOMAINS, savesSentAutomatically } from "./presets";
import { specialFolders } from "./settings";

export const MICROSOFT_REDIRECT_MESSAGE =
  "Los buzones de Outlook y Microsoft 365 se conectan con la opción «Outlook / Microsoft 365»: Microsoft ya no admite IMAP con contraseña y desactiva el envío SMTP con contraseña a finales de 2026.";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const serverSchema = z
  .object({
    host: z.string().trim().toLowerCase().min(3, "Escribe el servidor.").max(253, "El servidor es demasiado largo."),
    port: z.coerce
      .number()
      .int("El puerto es un número.")
      .min(1, "Puerto no válido.")
      .max(65_535, "Puerto no válido.")
      .refine((port) => !BLOCKED_PORTS.has(port), "El puerto 25 no se puede usar: usa 465 o 587."),
    security: z.enum(MAIL_SECURITY, { error: "Elige SSL/TLS o STARTTLS." }),
  })
  .strict();

export const imapConnectInputSchema = z
  .object({
    email: emailSchema,
    /** IMAP user; the address when empty. */
    username: z.preprocess(blankToUndefined, z.string().trim().max(320).optional()),
    /** Empty = keep the stored one (only for the same servers and users). */
    password: z.preprocess(blankToUndefined, z.string().min(1).max(500, "La contraseña es demasiado larga.").optional()),
    smtpUsername: z.preprocess(blankToUndefined, z.string().trim().max(320).optional()),
    smtpPassword: z.preprocess(blankToUndefined, z.string().min(1).max(500).optional()),
    imap: serverSchema,
    smtp: serverSchema,
  })
  .strict();
export type ImapConnectInput = z.infer<typeof imapConnectInputSchema>;

export type MailTestResult =
  | { ok: true; sentPath: string | null; draftsPath: string | null; savesSent: boolean }
  | { ok: false; microsoft?: boolean; imap: string | null; smtp: string | null; wrongPassword: boolean };

type Resolved = { imap: MailServerSettings; smtp: MailServerSettings };

function resolvedSettings(input: ImapConnectInput, passwords: MailPasswords): Resolved {
  const username = input.username ?? input.email;
  return {
    imap: { ...input.imap, username, password: passwords.password },
    smtp: { ...input.smtp, username: input.smtpUsername ?? username, password: passwords.smtpPassword ?? passwords.password },
  };
}

export function isMicrosoftMailbox(input: Pick<ImapConnectInput, "email" | "imap" | "smtp">): boolean {
  const domain = domainOf(input.email);
  return (domain !== null && MICROSOFT_DOMAINS.includes(domain)) || isMicrosoftMailHost(input.imap.host) || isMicrosoftMailHost(input.smtp.host);
}

/** «Probar conexión»: IMAP (login and folders) and SMTP (connect, TLS and login). */
export async function testMailConnection(input: ImapConnectInput, passwords: MailPasswords, connectors?: MailConnectors): Promise<MailTestResult> {
  if (isMicrosoftMailbox(input)) return { ok: false, microsoft: true, imap: MICROSOFT_REDIRECT_MESSAGE, smtp: null, wrongPassword: false };
  const settings = resolvedSettings(input, passwords);
  let imapError: string | null = null;
  let smtpError: string | null = null;
  let wrongPassword = false;
  let folders: { sentPath: string | null; draftsPath: string | null } = { sentPath: null, draftsPath: null };
  try {
    const client = await openImap(settings.imap, connectors);
    try {
      folders = specialFolders(await client.list());
    } finally {
      await closeImap(client);
    }
  } catch (error) {
    const info = describeMailError(error);
    imapError = info.message;
    wrongPassword ||= info.reconnect;
  }
  try {
    const smtp = await openSmtp(settings.smtp, connectors);
    try {
      await smtp.verify();
    } finally {
      smtp.close();
    }
  } catch (error) {
    const info = describeMailError(error);
    smtpError = info.message;
    wrongPassword ||= info.reconnect;
  }
  if (imapError || smtpError) return { ok: false, imap: imapError, smtp: smtpError, wrongPassword };
  return { ok: true, ...folders, savesSent: savesSentAutomatically(input.imap.host) || savesSentAutomatically(input.smtp.host) };
}

/** The passwords to use: the typed ones, or the stored ones only if nothing about where they go changed. */
export function passwordsFor(channel: Pick<ChannelRecord, "config" | "secretsEnc"> | null, input: ImapConnectInput): MailPasswords | null {
  const stored = channel ? readMailPasswords(channel) : null;
  const state = channel ? readEmailConfig(channel.config) : null;
  const imap = state?.imap;
  const sameImap =
    imap?.imapHost === input.imap.host && imap.imapPort === input.imap.port && imap.imapSecurity === input.imap.security && (imap.username || state?.emailAddress) === (input.username ?? input.email);
  const sameSmtp =
    imap?.smtpHost === input.smtp.host &&
    imap.smtpPort === input.smtp.port &&
    imap.smtpSecurity === input.smtp.security &&
    (imap.smtpUsername || imap.username || state?.emailAddress) === (input.smtpUsername ?? input.username ?? input.email);
  const password = input.password ?? (stored && sameImap && sameSmtp ? stored.password : null);
  if (!password) return null;
  const smtpPassword = input.smtpPassword ?? (input.password ? null : sameSmtp ? (stored?.smtpPassword ?? null) : null);
  return { password, smtpPassword };
}

export type ImapConnection = { ok: true; config: EmailConfigPatch; passwords: MailPasswords } | { ok: false; result: Extract<MailTestResult, { ok: false }> | null; error: string };

/** Tests and, when both work, returns what to store. Nothing is stored here. */
export async function connectImap(channel: Pick<ChannelRecord, "config" | "secretsEnc"> | null, input: ImapConnectInput, connectors?: MailConnectors): Promise<ImapConnection> {
  const passwords = passwordsFor(channel, input);
  if (!passwords) return { ok: false, result: null, error: "Escribe la contraseña del buzón." };
  const result = await testMailConnection(input, passwords, connectors);
  if (!result.ok) return { ok: false, result, error: result.imap ?? result.smtp ?? "No se ha podido conectar." };
  const previous = channel ? readEmailConfig(channel.config) : null;
  const sameMailbox = previous?.emailAddress === input.email && previous.imap.imapHost === input.imap.host;
  return {
    ok: true,
    passwords,
    config: {
      emailAddress: input.email,
      reconnect: null,
      syncFailures: 0,
      imap: {
        imapHost: input.imap.host,
        imapPort: input.imap.port,
        imapSecurity: input.imap.security,
        smtpHost: input.smtp.host,
        smtpPort: input.smtp.port,
        smtpSecurity: input.smtp.security,
        username: input.username ?? null,
        smtpUsername: input.smtpUsername ?? null,
        sentPath: result.sentPath,
        draftsPath: result.draftsPath,
        savesSent: result.savesSent,
        // Reconnecting the same mailbox keeps where it was; another one starts from now.
        ...(sameMailbox ? {} : { inbox: null, sent: null }),
      },
    },
  };
}

/** For the adapter's validateAndConnect («Revalidar»): the stored settings tested again. */
export async function revalidateImap(channel: ChannelRecord, input: unknown, connectors?: MailConnectors): Promise<ConnectResult> {
  const config = readEmailConfig(channel.config);
  const state = config.imap;
  const candidate =
    input && typeof input === "object" && Object.keys(input).length > 0
      ? input
      : {
          email: config.emailAddress,
          username: state.username ?? undefined,
          smtpUsername: state.smtpUsername ?? undefined,
          imap: { host: state.imapHost, port: state.imapPort, security: state.imapSecurity },
          smtp: { host: state.smtpHost, port: state.smtpPort, security: state.smtpSecurity },
        };
  const parsed = imapConnectInputSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: "Revisa los datos del servidor de correo." };
  const connection = await connectImap(channel, parsed.data, connectors);
  if (!connection.ok) return { ok: false, error: connection.error };
  return { ok: true, config: connection.config as Record<string, unknown>, secrets: { password: connection.passwords.password, ...(connection.passwords.smtpPassword ? { smtp_password: connection.passwords.smtpPassword } : {}) } };
}
