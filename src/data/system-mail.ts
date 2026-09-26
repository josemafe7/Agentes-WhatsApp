// System mail for the settings screens: «Enviar correo de prueba» (Correo del sistema, [AJU-06]) and the log and
// local outbox of Diagnóstico ([AJU-11]). The outbox (data/outbox/*.eml) only exists in development and the demo,
// where it is how invitation links reach people without SMTP ([USU-06]). A password reset link is a key to someone
// else's account, so it only opens for the person it was sent to.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { db } from "@/db";
import { systemEmails, user } from "@/db/schema";
import type { SystemEmailKind, SystemEmailStatus, SystemEmailTransport } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { ForbiddenError, NotFoundError, parseInput, RateLimitError } from "@/server/errors";
import { testEmail } from "@/server/email-templates";
import { isOutboxAllowed, OUTBOX_DIR, sendSystemEmail } from "@/server/mailer";
import { redactSecrets } from "@/server/redact";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { getEmailBrand } from "./business";

const TEST_EMAILS_PER_WINDOW = 5;
const TEST_EMAIL_WINDOW_MS = 10 * 60_000;
const SYSTEM_EMAILS_LIMIT = 20;
const MAX_TEXT_LENGTH = 20_000;
/** Names the mailer gives outbox files: ISO time with dashes plus a UUID. Anything else is refused. */
const OUTBOX_FILE_NAME = /^[A-Za-z0-9-]+\.eml$/;
const URL_IN_TEXT = /https?:\/\/[^\s<>"')]+/g;

export type TestEmailResult = { sent: true; via: "smtp" | "outbox"; to: string } | { sent: false; message: string };

async function emailOf(actor: Actor): Promise<string> {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, actor.userId));
  if (!row) throw new NotFoundError("No se ha encontrado tu usuario.");
  return row.email;
}

/** Sends a test email to the person who asks, with the saved SMTP (or the local outbox) ([AJU-06]). */
export async function sendTestEmail(actor: Actor): Promise<TestEmailResult> {
  assertCan(actor, PERMISSIONS.settings.integrations);
  const limit = await getRateLimiter().hit(`test-email:${actor.userId}`, TEST_EMAILS_PER_WINDOW, TEST_EMAIL_WINDOW_MS);
  if (!limit.allowed) throw new RateLimitError("Has enviado varios correos de prueba seguidos. Espera unos minutos.");
  const to = await emailOf(actor);
  const result = await sendSystemEmail({ kind: "test", to, ...testEmail({ brand: await getEmailBrand(), name: actor.name }) });
  // Whether it went out and how; never the address (personal data).
  await writeAudit({
    actor,
    action: "settings.test_email_sent",
    targetType: "system_email",
    targetId: result.logId,
    metadata: { ok: result.ok, via: result.ok ? result.via : null },
  });
  return result.ok ? { sent: true, via: result.via, to } : { sent: false, message: result.message };
}

export type SystemEmailSummary = {
  id: string;
  kind: SystemEmailKind;
  toEmail: string;
  subject: string;
  transport: SystemEmailTransport | null;
  status: SystemEmailStatus;
  error: string | null;
  createdAt: Date;
  /** Saved in the local outbox and openable by this person. */
  canOpen: boolean;
};

function canOpen(row: { kind: SystemEmailKind; toEmail: string; transport: SystemEmailTransport | null; outboxFile: string | null }, actorEmail: string): boolean {
  if (row.transport !== "outbox" || !row.outboxFile) return false;
  return row.kind !== "password_reset" || row.toEmail === actorEmail;
}

/** Latest system emails (sent, saved locally or failed) for Diagnóstico. */
export async function listSystemEmails(actor: Actor): Promise<{ outboxEnabled: boolean; emails: SystemEmailSummary[] }> {
  assertCan(actor, PERMISSIONS.settings.diagnostics);
  const outboxEnabled = isOutboxAllowed();
  const actorEmail = await emailOf(actor);
  const rows = await db.select().from(systemEmails).orderBy(desc(systemEmails.createdAt)).limit(SYSTEM_EMAILS_LIMIT);
  return {
    outboxEnabled,
    emails: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      toEmail: row.toEmail,
      subject: row.subject,
      transport: row.transport,
      status: row.status,
      error: row.error ? redactSecrets(row.error) : null,
      createdAt: row.createdAt,
      canOpen: outboxEnabled && canOpen(row, actorEmail),
    })),
  };
}

export type OutboxEmail = { id: string; kind: SystemEmailKind; subject: string; to: string; date: Date; text: string; links: string[] };

const emailIdInput = z.object({ emailId: z.string().trim().min(1, "Falta el correo.").max(100) });

/** Opens a locally saved email to copy its links (invitation, test…). Development and demo only. */
export async function readOutboxEmail(actor: Actor, input: unknown, options: { outboxDir?: string } = {}): Promise<OutboxEmail> {
  assertCan(actor, PERMISSIONS.settings.diagnostics);
  const { emailId } = parseInput(emailIdInput, input);
  if (!isOutboxAllowed()) throw new ForbiddenError("La bandeja local solo existe en local y en la demo.");
  const [row] = await db.select().from(systemEmails).where(eq(systemEmails.id, emailId));
  if (!row || row.transport !== "outbox" || !row.outboxFile || !OUTBOX_FILE_NAME.test(row.outboxFile)) {
    throw new NotFoundError("Ese correo no está en la bandeja local.");
  }
  if (!canOpen(row, await emailOf(actor))) {
    throw new ForbiddenError("Solo la persona a la que se envió puede abrir un enlace para cambiar la contraseña.");
  }
  const dir = path.resolve(options.outboxDir ?? OUTBOX_DIR);
  const file = path.resolve(dir, row.outboxFile);
  if (path.dirname(file) !== dir) throw new NotFoundError("Ese correo no está en la bandeja local.");
  let raw: Buffer;
  try {
    raw = await fs.promises.readFile(file);
  } catch {
    throw new NotFoundError("El archivo de ese correo ya no está en la bandeja local.");
  }
  const parsed = await simpleParser(raw);
  const text = (parsed.text ?? "").slice(0, MAX_TEXT_LENGTH);
  return {
    id: row.id,
    kind: row.kind,
    subject: parsed.subject ?? row.subject,
    to: row.toEmail,
    date: parsed.date ?? row.createdAt,
    text,
    links: [...new Set(text.match(URL_IN_TEXT) ?? [])],
  };
}
