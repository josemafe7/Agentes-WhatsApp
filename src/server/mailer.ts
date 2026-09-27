// System mail (invitations, password resets, notices) through the SMTP of Settings › Correo del sistema
// ([AJU-06]). Without SMTP, in development or the demo the message is saved as a .eml in data/outbox and
// listed in Diagnóstico; in production it fails with a clear error. Every attempt is logged in system_emails.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import nodemailer, { type SendMailOptions } from "nodemailer";
import { getSmtpConfig, type SmtpConfig } from "@/data/settings";
import { db } from "@/db";
import { systemEmails } from "@/db/schema";
import type { SystemEmailKind, SystemEmailStatus, SystemEmailTransport } from "@/lib/enums";
import { emailSchema } from "@/lib/validation";
import { safeErrorMessage } from "./redact";

export const OUTBOX_DIR = path.join(process.cwd(), "data", "outbox");
/** Every message the app sends carries this header, so its own mail is never taken as a customer's ([COR-18]). */
export const SYSTEM_EMAIL_HEADER = "X-DominIA-System";
const SMTP_CONNECTION_TIMEOUT_MS = 15_000;
const SMTP_SOCKET_TIMEOUT_MS = 30_000;

/** `replyTo`: where the recipient's answer goes (a booking reminder: the business's mailbox, [AGD-26]). */
export type SystemEmail = { kind: SystemEmailKind; to: string; subject: string; text: string; html?: string; replyTo?: string };
export type MailSender = { sendMail(options: SendMailOptions): Promise<unknown> };
export type SendSystemEmailResult =
  | { ok: true; via: "smtp"; logId: string }
  | { ok: true; via: "outbox"; logId: string; file: string }
  | { ok: false; reason: "not_configured" | "send_failed"; message: string; logId: string };

export type MailerOptions = {
  /** Folder for .eml files (default data/outbox). */
  outboxDir?: string;
  /** SMTP settings to use (default: Settings › Correo del sistema). */
  smtp?: SmtpConfig | null;
  createTransport?: (config: SmtpConfig) => MailSender;
};

export const NOT_CONFIGURED_MESSAGE =
  "El correo del sistema no está configurado: configúralo en Ajustes › Correo del sistema.";
const SEND_FAILED_MESSAGE = "No se pudo enviar el correo. Revisa el correo del sistema en Ajustes.";

/** Development and the demo keep unsent mail in data/outbox; a published installation needs SMTP. */
export function isOutboxAllowed(): boolean {
  return process.env.DEMO_MODE === "true" || process.env.NODE_ENV !== "production";
}

function smtpTransport(config: SmtpConfig): MailSender {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === "tls",
    // STARTTLS must succeed: never send the password or the message in clear text on 587.
    requireTLS: config.security === "starttls",
    ignoreTLS: config.security === "none",
    auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  });
}

function message(email: SystemEmail, from: SendMailOptions["from"]): SendMailOptions {
  return {
    from,
    to: email.to,
    ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    subject: email.subject,
    text: email.text,
    ...(email.html ? { html: email.html } : {}),
    headers: { [SYSTEM_EMAIL_HEADER]: email.kind },
    // Nothing in a message may read server files or fetch URLs.
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

async function logAttempt(
  email: SystemEmail,
  status: SystemEmailStatus,
  transport: SystemEmailTransport | null,
  details: { outboxFile?: string; error?: string } = {},
): Promise<string> {
  const [row] = await db
    .insert(systemEmails)
    .values({
      kind: email.kind,
      toEmail: email.to,
      subject: email.subject,
      transport,
      status,
      outboxFile: details.outboxFile ?? null,
      error: details.error ?? null,
    })
    .returning({ id: systemEmails.id });
  return row.id;
}

async function saveToOutbox(email: SystemEmail, outboxDir: string): Promise<string> {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await composer.sendMail(message(email, { name: "DominIA Agentes", address: "no-reply@localhost" }));
  const raw = info.message;
  if (!Buffer.isBuffer(raw)) throw new Error("El mensaje no se pudo componer.");
  await fs.promises.mkdir(outboxDir, { recursive: true });
  const file = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}.eml`;
  await fs.promises.writeFile(path.join(outboxDir, file), raw);
  return file;
}

/** Sends a system email. Never throws for delivery problems: the result says what happened. */
export async function sendSystemEmail(email: SystemEmail, options: MailerOptions = {}): Promise<SendSystemEmailResult> {
  const to = emailSchema.parse(email.to);
  const replyTo = email.replyTo ? emailSchema.parse(email.replyTo) : undefined;
  // Header injection guard: a subject is one line.
  const safeEmail: SystemEmail = { ...email, to, replyTo, subject: email.subject.replace(/[\r\n]+/g, " ").trim() };
  const smtp = options.smtp !== undefined ? options.smtp : await getSmtpConfig();

  if (smtp) {
    try {
      const transport = (options.createTransport ?? smtpTransport)(smtp);
      await transport.sendMail(message(safeEmail, { name: smtp.fromName ?? "", address: smtp.fromEmail }));
      return { ok: true, via: "smtp", logId: await logAttempt(safeEmail, "sent", "smtp") };
    } catch (error) {
      const logId = await logAttempt(safeEmail, "failed", "smtp", { error: safeErrorMessage(error) });
      return { ok: false, reason: "send_failed", message: SEND_FAILED_MESSAGE, logId };
    }
  }

  if (isOutboxAllowed()) {
    try {
      const file = await saveToOutbox(safeEmail, options.outboxDir ?? OUTBOX_DIR);
      return { ok: true, via: "outbox", file, logId: await logAttempt(safeEmail, "saved", "outbox", { outboxFile: file }) };
    } catch (error) {
      const logId = await logAttempt(safeEmail, "failed", "outbox", { error: safeErrorMessage(error) });
      return { ok: false, reason: "send_failed", message: SEND_FAILED_MESSAGE, logId };
    }
  }

  const logId = await logAttempt(safeEmail, "failed", null, { error: "not_configured" });
  return { ok: false, reason: "not_configured", message: NOT_CONFIGURED_MESSAGE, logId };
}
